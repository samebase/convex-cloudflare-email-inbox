import { APIError } from "cloudflare/error";
import { BaseEmailSending } from "cloudflare/resources/email-sending/email-sending";
import { createClient } from "cloudflare/tree-shakable";
import { Infer, v } from "convex/values";
import { z } from "zod";
import { recipientResults } from "./schema";

export const sendPayload = v.object({
  from: v.string(),
  senderName: v.optional(v.string()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  subject: v.string(),
  text: v.string(),
  inReplyTo: v.union(v.string(), v.null()),
  references: v.array(v.string()),
});

export const sendOutcome = v.union(
  v.object({
    kind: v.literal("accepted"),
    providerMessageId: v.string(),
    recipientResults: v.optional(recipientResults),
  }),
  v.object({ kind: v.literal("rejected"), code: v.string() }),
  v.object({ kind: v.literal("unknown") }),
);

// Cloudflare's current structured send response, retrieved 2026-10-01:
// https://developers.cloudflare.com/api/resources/email_sending/methods/send/
const cloudflareReceipt = z.object({
  success: z.literal(true),
  result: z.object({
    message_id: z.string().min(1),
    delivered: z.array(z.string()),
    queued: z.array(z.string()),
    permanent_bounces: z.array(z.string()),
    suppressed_recipients: z.array(z.string()),
  }),
});

export function safeRfcMessageId(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return /^<[^<>\s@]+@[^<>\s@]+>$/.test(normalized) &&
    new TextEncoder().encode(normalized).byteLength <= 2_048
    ? normalized
    : null;
}

export async function sendCloudflareEmail(args: {
  apiToken: string;
  accountId: string;
  payload: Infer<typeof sendPayload>;
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

  const client = createClient({
    resources: [BaseEmailSending],
    apiToken: args.apiToken,
    maxRetries: 0,
    timeout: 30_000,
    logLevel: "off",
  });
  try {
    const response = await client.emailSending
      .send({
        account_id: args.accountId,
        from: args.payload.senderName
          ? { address: args.payload.from, name: args.payload.senderName }
          : args.payload.from,
        to: args.payload.to,
        ...(args.payload.cc.length ? { cc: args.payload.cc } : {}),
        subject: args.payload.subject,
        text: args.payload.text,
        ...(Object.keys(headers).length ? { headers } : {}),
      })
      .asResponse();
    const rawReceipt: unknown = await response.json();
    const parsed = cloudflareReceipt.safeParse(rawReceipt);
    if (!parsed.success) {
      return { kind: "unknown" };
    }
    const result = parsed.data.result;
    return {
      kind: "accepted",
      providerMessageId: result.message_id,
      recipientResults: {
        delivered: result.delivered,
        queued: result.queued,
        permanent_bounces: result.permanent_bounces,
        suppressed_recipients: result.suppressed_recipients,
      },
    };
  } catch (error) {
    if (error instanceof APIError && error.status && error.status >= 400 && error.status < 500) {
      return { kind: "rejected", code: `cloudflare_http_${error.status}` };
    }
    return { kind: "unknown" };
  }
}
