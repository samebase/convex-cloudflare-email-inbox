import { v } from "convex/values";

export const outboundAttachment = v.object({
  r2Key: v.string(),
  filename: v.string(),
  contentType: v.string(),
  byteSize: v.number(),
  sha256: v.string(),
});

export const messageContentFields = {
  idempotencyKey: v.string(),
  text: v.optional(v.string()),
  html: v.optional(v.string()),
  cc: v.optional(v.array(v.string())),
  bcc: v.optional(v.array(v.string())),
  replyTo: v.optional(v.string()),
  attachments: v.optional(v.array(outboundAttachment)),
};

export const sendOptions = v.object({
  ...messageContentFields,
  inboxId: v.optional(v.string()),
  from: v.optional(
    v.union(v.string(), v.object({ address: v.string(), name: v.optional(v.string()) })),
  ),
  to: v.array(v.string()),
  subject: v.string(),
});

export const replyOptions = v.object({
  ...messageContentFields,
  messageId: v.string(),
  to: v.optional(v.array(v.string())),
  subject: v.optional(v.string()),
});
