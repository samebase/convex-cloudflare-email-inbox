import { APIError } from "cloudflare/error";
import {
  BaseEmailSending,
  type EmailSendingSendParams,
} from "cloudflare/resources/email-sending/email-sending";
import { createClient } from "cloudflare/tree-shakable";
import { Infer, v } from "convex/values";
import { createMimeMessage, Mailbox } from "mimetext/browser";
import { z } from "zod";
import { recipientResults } from "../client/monitor";
import { outboundAttachment } from "./messageTypes";

// https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
export const MAX_OUTBOUND_BYTES = 5 * 1_024 * 1_024;

export const sendPayload = v.object({
  from: v.string(),
  senderName: v.optional(v.string()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  replyTo: v.union(v.string(), v.null()),
  subject: v.string(),
  text: v.string(),
  html: v.union(v.string(), v.null()),
  attachments: v.array(outboundAttachment),
  inReplyTo: v.union(v.string(), v.null()),
  references: v.array(v.string()),
});

export const sendOutcome = v.union(
  v.object({
    kind: v.literal("accepted"),
    providerMessageId: v.optional(v.string()),
    recipientResults: v.optional(recipientResults),
  }),
  v.object({ kind: v.literal("rejected"), code: v.string() }),
  v.object({ kind: v.literal("throttled"), retryAt: v.number() }),
  v.object({ kind: v.literal("unknown") }),
);

// Both documented REST response shapes, retrieved 2026-10-02:
// https://developers.cloudflare.com/api/resources/email_sending/methods/send/
// https://developers.cloudflare.com/email-service/api/send-emails/rest-api/#response
const cloudflareReceipt = z.object({
  success: z.literal(true),
  result: z.object({
    message_id: z.string().min(1).optional(),
    delivered: z.array(z.string()),
    queued: z.array(z.string()),
    permanent_bounces: z.array(z.string()),
    suppressed_recipients: z.array(z.string()).optional(),
  }),
});

const cloudflareError = z.object({ errors: z.array(z.object({ code: z.number().int() })) });

export function safeRfcMessageId(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  // A message ID must fit one continuation line, including its leading space.
  return /^<[^<>\s@]+@[^<>\s@]+>$/.test(normalized) &&
    new TextEncoder().encode(normalized).byteLength <= 997
    ? normalized
    : null;
}

export async function sendCloudflareEmail(args: {
  apiToken: string;
  accountId: string;
  payload: Infer<typeof sendPayload>;
  attachments?: EmailSendingSendParams.EmailSendingEmailAttachment[];
}): Promise<Infer<typeof sendOutcome>> {
  const headers: Record<string, string> = {};
  const inReplyTo = safeRfcMessageId(args.payload.inReplyTo);
  if (inReplyTo) {
    headers["In-Reply-To"] = inReplyTo;
  }
  const references: string[] = [];
  let referenceBytes = 0;
  for (const value of args.payload.references.toReversed()) {
    const messageId = safeRfcMessageId(value);
    if (!messageId) {
      continue;
    }
    const bytes = new TextEncoder().encode(messageId).byteLength + (references.length ? 1 : 0);
    if (referenceBytes + bytes <= 2_048) {
      references.unshift(messageId);
      referenceBytes += bytes;
    }
  }
  if (references.length) {
    headers["References"] = references.join(" ");
  }

  const body = {
    from: args.payload.senderName
      ? { address: args.payload.from, name: args.payload.senderName }
      : args.payload.from,
    to: args.payload.to,
    ...(args.payload.cc.length ? { cc: args.payload.cc } : {}),
    ...(args.payload.bcc.length ? { bcc: args.payload.bcc } : {}),
    ...(args.payload.replyTo ? { reply_to: args.payload.replyTo } : {}),
    subject: args.payload.subject,
    ...(args.payload.text ? { text: args.payload.text } : {}),
    ...(args.payload.html ? { html: args.payload.html } : {}),
    ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_OUTBOUND_BYTES) {
    return { kind: "rejected", code: "message_too_large" };
  }
  const client = createClient({
    resources: [BaseEmailSending],
    apiToken: args.apiToken,
    maxRetries: 0,
    timeout: 30_000,
    logLevel: "off",
  });
  try {
    let response: Response;
    if (args.attachments?.length) {
      // Structured sending can convert text attachments to 7bit. Keep file bytes base64-encoded.
      const mime = createMimeMessage();
      mime.setSender(args.payload.from);
      mime.setTo(args.payload.to);
      if (args.payload.cc.length) mime.setCc(args.payload.cc);
      // Bcc belongs only in the SMTP envelope, never in the raw message headers.
      mime.setSubject(args.payload.subject);
      mime.setHeaders({
        ...headers,
        ...(inReplyTo ? { "In-Reply-To": `\r\n ${inReplyTo}` } : {}),
        ...(references.length ? { References: `\r\n ${references.join("\r\n ")}` } : {}),
      });
      if (args.payload.replyTo) mime.setHeader("Reply-To", new Mailbox(args.payload.replyTo));
      if (args.payload.text) {
        mime.addMessage({
          contentType: "text/plain",
          encoding: "base64",
          data: mime.toBase64(args.payload.text).replace(/.{76}/g, "$&\r\n"),
        });
      }
      if (args.payload.html) {
        mime.addMessage({
          contentType: "text/html",
          encoding: "base64",
          data: mime.toBase64(args.payload.html).replace(/.{76}/g, "$&\r\n"),
        });
      }
      for (const attachment of args.attachments) {
        const filename = encodeURIComponent(attachment.filename).replace(
          /['()*]/g,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        const part = mime.addAttachment({
          filename: attachment.filename,
          contentType: attachment.type,
          encoding: "base64",
          data: attachment.content.replace(/.{76}/g, "$&\r\n"),
        });
        part.setHeader("Content-Type", attachment.type);
        const filenameParts = filename.match(/(?:%[0-9A-F]{2}|[^%]){1,50}/g) ?? [""];
        part.setHeader(
          "Content-Disposition",
          `attachment;\r\n ${filenameParts.map((value, index) => `filename*${index}*=${index === 0 ? "UTF-8''" : ""}${value}`).join(";\r\n ")}`,
        );
      }
      // MIMEText does not fold encoded words in Subject or sender names.
      const encodeHeaderWords = (value: string) =>
        (value.match(/.{1,9}/gsu) ?? [""])
          .map((word) => `=?UTF-8?B?${mime.toBase64(word)}?=`)
          .join("\r\n ");
      const rawBody = {
        from: args.payload.from,
        recipients: [...args.payload.to, ...args.payload.cc, ...args.payload.bcc],
        mime_message: mime
          .asRaw()
          .replace(/^Subject:.*$/m, () => `Subject: ${encodeHeaderWords(args.payload.subject)}`)
          .replace(/^From:.*$/m, (header) =>
            args.payload.senderName
              ? `From: ${encodeHeaderWords(args.payload.senderName)}\r\n <${args.payload.from}>`
              : header,
          ),
      };
      if (new TextEncoder().encode(JSON.stringify(rawBody)).byteLength > MAX_OUTBOUND_BYTES) {
        return { kind: "rejected", code: "message_too_large" };
      }
      response = await client.emailSending
        .sendRaw({ account_id: args.accountId, ...rawBody })
        .asResponse();
    } else {
      response = await client.emailSending
        .send({ account_id: args.accountId, ...body })
        .asResponse();
    }
    const rawReceipt: unknown = await response.json();
    const parsed = cloudflareReceipt.safeParse(rawReceipt);
    if (!parsed.success) {
      return { kind: "unknown" };
    }
    const result = parsed.data.result;
    return {
      kind: "accepted",
      ...(result.message_id ? { providerMessageId: result.message_id } : {}),
      recipientResults: {
        delivered: result.delivered,
        queued: result.queued,
        permanent_bounces: result.permanent_bounces,
        ...(result.suppressed_recipients === undefined
          ? {}
          : { suppressed_recipients: result.suppressed_recipients }),
      },
    };
  } catch (error) {
    if (error instanceof APIError && error.status === 429) {
      const value = error.headers?.get("retry-after")?.trim();
      const now = Date.now();
      const retryAt = value
        ? /^\d+(?:\.\d+)?$/.test(value)
          ? now + Number(value) * 1_000
          : Date.parse(value)
        : NaN;
      if (value && /^\d+(?:\.\d+)?$/.test(value) && !Number.isFinite(retryAt)) {
        return { kind: "rejected", code: "cloudflare_http_429" };
      }
      return {
        kind: "throttled",
        retryAt: Number.isFinite(retryAt) ? Math.max(now + 1_000, retryAt) : now + 1_000,
      };
    }
    if (error instanceof APIError && error.status === 408) {
      return { kind: "unknown" };
    }
    if (error instanceof APIError && error.status && error.status >= 400 && error.status < 500) {
      const parsed = cloudflareError.safeParse(error.error);
      const code = parsed.success ? parsed.data.errors[0]?.code : undefined;
      return {
        kind: "rejected",
        code: code === undefined ? `cloudflare_http_${error.status}` : `cloudflare_${code}`,
      };
    }
    return { kind: "unknown" };
  }
}
