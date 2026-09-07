import PostalMime, { type Address, type Email } from "postal-mime";
import {
  beginIngressResponse,
  completeIngressRequest,
  completeIngressResponse,
  mailAddress,
  type BeginIngressRequest,
  type CompleteIngressRequest,
} from "../shared/mailProtocol";

const MAX_RAW_BYTES = 25 * 1_024 * 1_024;
const MAX_BODY_BYTES = 512 * 1_024;

type InboundMessage = Pick<
  ForwardableEmailMessage,
  "from" | "to" | "raw" | "rawSize" | "setReject"
>;
type InboundEnvironment = {
  CONVEX_SITE_URL: string;
  MAIL_BRIDGE_SECRET: string;
  MAIL_STORAGE: {
    put(
      key: string,
      value: ArrayBuffer | Uint8Array,
      options: {
        httpMetadata: { contentType: string };
        customMetadata: Record<string, string>;
      },
    ): Promise<unknown>;
  };
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

function plainTextFromHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
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

function safeFilename(filename: string | null, ordinal: number) {
  const originalFilename = (filename?.split(/[/\\]/).at(-1) || `attachment-${ordinal}`).slice(
    0,
    512,
  );
  const cleaned = Array.from(originalFilename.normalize("NFKC"), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || '<>:"/\\|?*'.includes(character) ? "-" : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 140);
  return { originalFilename, safeFilename: cleaned || `attachment-${ordinal}` };
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
      const response = await fetch(`${env.CONVEX_SITE_URL}${path}`, {
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
