import PostalMime, { type Address, type Email } from "postal-mime";
import {
  beginIngressResponse,
  completeIngressRequest,
  completeIngressResponse,
  mailAddress,
  type BeginIngressRequest,
  type CompleteIngressRequest,
} from "../component/mailProtocol.js";
import { safeFilename, verifyObjectGrant, type AttachmentBucket } from "../r2.js";
import { plainTextFromHtml } from "../component/text.js";

const MAX_RAW_BYTES = 25 * 1_024 * 1_024;
const MAX_BODY_BYTES = 512 * 1_024;

type InboundMessage = {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject: (reason: string) => void;
};
type InboundEnvironment = {
  CONVEX_SITE_URL: string;
  MAIL_BRIDGE_SECRET: string;
  MAIL_STORAGE: AttachmentBucket;
};

function hexadecimal(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatAddress(value: Address): string {
  if (value.group) {
    return value.group.map(formatAddress).join(", ");
  }
  return value.name ? `${value.name} <${value.address}>` : value.address;
}

function formatAddresses(values: Address[] | undefined) {
  return values?.flatMap((value) => (value.group ? value.group : [value])).map(formatAddress) ?? [];
}

function normalizedAddress(value: string | undefined) {
  const parsed = mailAddress.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function replyAddress(values: Address[] | undefined, from: Address | undefined, envelope: string) {
  const first = values?.flatMap((value) => (value.group ? value.group : [value])).at(0)?.address;
  return (
    normalizedAddress(first) ?? normalizedAddress(from?.address) ?? normalizedAddress(envelope)
  );
}

function boundedBody(content: string) {
  const encoded = new TextEncoder().encode(content);
  const truncated = encoded.byteLength > MAX_BODY_BYTES;
  return {
    content: truncated ? new TextDecoder().decode(encoded.slice(0, MAX_BODY_BYTES)) : content,
    originalByteCount: encoded.byteLength,
    truncated,
  };
}

function contentBytes(content: ArrayBuffer | Uint8Array | string) {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function rawOnlyRequest(
  recipient: string,
  ingressKey: string,
  envelopeFrom: string,
  receivedAt: number,
  code: string,
) {
  return completeIngressRequest.parse({
    version: 1,
    recipient,
    ingressKey,
    parse: { kind: "failed", code },
    headerFrom: envelopeFrom.slice(0, 998),
    replyToAddress: normalizedAddress(envelopeFrom),
    headerTo: [recipient],
    headerCc: [],
    rfcMessageId: null,
    inReplyTo: null,
    references: [],
    subject: "Unreadable message",
    snippet: "The raw message is available for download.",
    occurredAt: receivedAt,
    bodies: [],
    attachments: [],
  });
}

async function postConvex<T>(
  env: InboundEnvironment,
  path: string,
  value: unknown,
  parse: (input: unknown) => T,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${env.CONVEX_SITE_URL.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.MAIL_BRIDGE_SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Mail backend returned ${response.status}`);
      }
      return parse(await response.json());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Mail backend request failed");
}

export async function receiveEmail(message: InboundMessage, env: InboundEnvironment) {
  if (!env.MAIL_BRIDGE_SECRET) throw new Error("Mail ingress is not configured");
  if (message.rawSize > MAX_RAW_BYTES) {
    message.setReject("Message exceeds the 25 MiB limit");
    return;
  }
  const recipient = message.to.trim().toLowerCase();
  const envelopeFrom = message.from.trim().toLowerCase();
  const raw = await new Response(message.raw).arrayBuffer();
  const digest = hexadecimal(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)));
  const receivedAt = Date.now();
  const beginRequest: BeginIngressRequest = {
    version: 1,
    recipient,
    ingressKey: digest,
    envelopeFrom,
    rawSize: raw.byteLength,
    receivedAt,
  };
  const begin = await postConvex(env, "/api/mail/ingress/begin", beginRequest, (input) =>
    beginIngressResponse.parse(input),
  );
  if (begin.kind === "reject") {
    message.setReject("Unknown inbox");
    return;
  }
  if (begin.kind === "duplicate") {
    return;
  }
  await env.MAIL_STORAGE.put(begin.rawR2Key, raw, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { recipient, ingressKey: digest },
  });

  let parsedEmail: Email | null = null;
  try {
    parsedEmail = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  } catch {
    parsedEmail = null;
  }

  let completeRequest: CompleteIngressRequest;
  if (parsedEmail) {
    const parsed = parsedEmail;
    const bodyText = parsed.text ?? (parsed.html ? plainTextFromHtml(parsed.html) : "");
    const bodies = bodyText ? [boundedBody(bodyText)] : [];
    const attachmentPrefix = `${begin.rawR2Key.slice(0, -"raw.eml".length)}attachments/`;
    const attachments = [];
    const attachmentWrites = [];
    for (const [index, item] of parsed.attachments.slice(0, 200).entries()) {
      const ordinal = index + 1;
      const names = safeFilename(item.filename, ordinal);
      const r2Key = `${attachmentPrefix}${String(ordinal).padStart(3, "0")}-${names.safeFilename}`;
      const bytes = contentBytes(item.content);
      const mimeType = item.mimeType.slice(0, 255) || "application/octet-stream";
      attachmentWrites.push({ r2Key, bytes, mimeType, originalFilename: names.originalFilename });
      attachments.push({
        ordinal,
        r2Key,
        originalFilename: names.originalFilename,
        mimeType,
        byteSize: bytes.byteLength,
      });
    }
    const references = (parsed.references ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(-20)
      .map((value) => value.slice(0, 998));
    const candidate = completeIngressRequest.safeParse({
      version: 1,
      recipient,
      ingressKey: digest,
      parse: { kind: "parsed" },
      headerFrom: (parsed.from ? formatAddress(parsed.from) : envelopeFrom).slice(0, 998),
      replyToAddress: replyAddress(parsed.replyTo, parsed.from, envelopeFrom),
      headerTo: formatAddresses(parsed.to)
        .slice(0, 100)
        .map((value) => value.slice(0, 998)),
      headerCc: formatAddresses(parsed.cc)
        .slice(0, 100)
        .map((value) => value.slice(0, 998)),
      rfcMessageId: parsed.messageId?.slice(0, 998) ?? null,
      inReplyTo: parsed.inReplyTo?.slice(0, 998) ?? null,
      references,
      subject: parsed.subject?.trim().slice(0, 998) || "(no subject)",
      snippet: bodyText.replace(/\s+/g, " ").trim().slice(0, 280),
      occurredAt: receivedAt,
      bodies,
      attachments,
    });
    if (candidate.success) {
      for (const item of attachmentWrites) {
        await env.MAIL_STORAGE.put(item.r2Key, item.bytes, {
          httpMetadata: { contentType: item.mimeType },
          customMetadata: { originalFilename: item.originalFilename },
        });
      }
      completeRequest = candidate.data;
    } else {
      completeRequest = rawOnlyRequest(
        recipient,
        digest,
        envelopeFrom,
        receivedAt,
        "mime_metadata_invalid",
      );
    }
  } else {
    completeRequest = rawOnlyRequest(
      recipient,
      digest,
      envelopeFrom,
      receivedAt,
      "mime_parse_failed",
    );
  }
  await postConvex(env, "/api/mail/ingress/complete", completeRequest, (input) =>
    completeIngressResponse.parse(input),
  );
}

export async function downloadObject(
  request: Request,
  env: {
    MAIL_BRIDGE_SECRET: string;
    MAIL_STORAGE: {
      get: (key: string) => Promise<{ body: ReadableStream<Uint8Array> } | null>;
    };
  },
) {
  const grant = new URL(request.url).searchParams.get("grant");
  if (!grant) return new Response("Not found", { status: 404 });
  if (!env.MAIL_BRIDGE_SECRET) return new Response("Service unavailable", { status: 503 });
  const payload = await verifyObjectGrant(grant, env.MAIL_BRIDGE_SECRET);
  if (!payload) return new Response("Not found", { status: 404 });
  const object = await env.MAIL_STORAGE.get(payload.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  const filename = payload.filename.replace(/[\r\n]/g, " ");
  return new Response(object.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "content-type": payload.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
