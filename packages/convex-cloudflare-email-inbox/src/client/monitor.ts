import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";

export const historyStatus = v.union(
  v.literal("received"),
  v.literal("queued"),
  v.literal("sending"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("unknown"),
  v.literal("parse_failed"),
);

export const listHistoryArgs = v.object({
  inboxId: v.union(v.string(), v.null()),
  status: v.union(historyStatus, v.null()),
  paginationOpts: paginationOptsValidator,
});

export const historySummary = v.object({
  _id: v.string(),
  inboxId: v.string(),
  inboxAddress: v.string(),
  threadId: v.string(),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  status: historyStatus,
  from: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  subject: v.string(),
  snippet: v.string(),
  occurredAt: v.number(),
});

export const historyPage = paginationResultValidator(historySummary);

export const inboxView = v.object({
  _id: v.string(),
  address: v.string(),
  label: v.string(),
  localPart: v.string(),
  unreadCount: v.number(),
});

export const messageView = v.object({
  _id: v.string(),
  inboxId: v.string(),
  threadId: v.string(),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  status: historyStatus,
  from: v.string(),
  replyTo: v.union(v.string(), v.null()),
  replyRecipient: v.union(v.string(), v.null()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  subject: v.string(),
  occurredAt: v.number(),
  rfcMessageId: v.union(v.string(), v.null()),
  references: v.array(v.string()),
  bodyText: v.string(),
  bodyHtml: v.union(v.string(), v.null()),
  bodyTruncated: v.boolean(),
  rawAvailable: v.boolean(),
  attachments: v.array(
    v.object({
      _id: v.string(),
      filename: v.string(),
      mimeType: v.string(),
      byteSize: v.number(),
    }),
  ),
});

export const recipientResults = v.object({
  delivered: v.array(v.string()),
  queued: v.array(v.string()),
  permanent_bounces: v.array(v.string()),
  suppressed_recipients: v.optional(v.array(v.string())),
});

export const deliveryView = v.union(
  v.object({ kind: v.literal("queued"), queuedAt: v.number(), notBefore: v.optional(v.number()) }),
  v.object({ kind: v.literal("sending"), startedAt: v.number() }),
  v.object({
    kind: v.literal("accepted"),
    acceptedAt: v.number(),
    providerMessageId: v.optional(v.string()),
    recipientResults: v.optional(recipientResults),
  }),
  v.object({ kind: v.literal("rejected"), failedAt: v.number(), code: v.string() }),
  v.object({ kind: v.literal("unknown"), observedAt: v.number() }),
);

export type HistoryStatus = Infer<typeof historyStatus>;
export type ListHistoryArgs = Infer<typeof listHistoryArgs>;
export type HistorySummary = Infer<typeof historySummary>;
export type HistoryPage = Infer<typeof historyPage>;
export type InboxView = Infer<typeof inboxView>;
export type MessageView = Infer<typeof messageView>;
export type DeliveryView = Infer<typeof deliveryView>;
