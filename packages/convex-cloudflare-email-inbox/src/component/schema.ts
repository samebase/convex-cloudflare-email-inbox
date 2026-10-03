import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { deliveryView } from "../client/monitor";

export const ingressState = v.union(
  v.object({ kind: v.literal("reserved"), reservedAt: v.number() }),
  v.object({
    kind: v.literal("committed"),
    messageId: v.id("emailMessages"),
    committedAt: v.number(),
  }),
);

export const messageTransport = v.union(
  v.object({
    kind: v.literal("inbound"),
    rawR2Key: v.string(),
    parse: v.union(
      v.object({ kind: v.literal("parsed") }),
      v.object({ kind: v.literal("failed"), code: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal("outbound"),
    clientRequestId: v.string(),
    attempt: v.optional(v.number()),
    delivery: deliveryView,
  }),
);

export default defineSchema({
  mailDomains: defineTable({
    domain: v.string(),
    createdAt: v.number(),
  }).index("by_domain", ["domain"]),
  inboxes: defineTable({
    domainId: v.id("mailDomains"),
    localPart: v.string(),
    address: v.string(),
    label: v.string(),
    unreadCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_address", ["address"])
    .index("by_domain_and_local_part", ["domainId", "localPart"])
    .index("by_created_at", ["createdAt"]),
  ingressReceipts: defineTable({
    inboxId: v.id("inboxes"),
    ingressKey: v.string(),
    rawR2Key: v.string(),
    rawSize: v.number(),
    envelopeFrom: v.string(),
    receivedAt: v.number(),
    state: ingressState,
  }).index("by_inbox_and_ingress_key", ["inboxId", "ingressKey"]),
  emailThreads: defineTable({
    inboxId: v.id("inboxes"),
    subject: v.string(),
    snippet: v.string(),
    lastFrom: v.string(),
    lastActivityAt: v.number(),
    messageCount: v.number(),
    unreadCount: v.number(),
  })
    .index("by_inbox_and_last_activity_at", ["inboxId", "lastActivityAt"])
    .index("by_last_activity_at", ["lastActivityAt"]),
  emailMessages: defineTable({
    inboxId: v.id("inboxes"),
    threadId: v.id("emailThreads"),
    envelopeFrom: v.string(),
    envelopeTo: v.string(),
    headerFrom: v.string(),
    senderName: v.optional(v.string()),
    replyToAddress: v.optional(v.string()),
    headerTo: v.array(v.string()),
    headerCc: v.array(v.string()),
    headerBcc: v.optional(v.array(v.string())),
    rfcMessageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    replyToMessageId: v.optional(v.id("emailMessages")),
    references: v.array(v.string()),
    subject: v.string(),
    snippet: v.string(),
    occurredAt: v.number(),
    clientRequestId: v.optional(v.string()),
    transport: messageTransport,
  })
    .index("by_occurred_at", ["occurredAt"])
    .index("by_inbox_and_occurred_at", ["inboxId", "occurredAt"])
    .index("by_delivery_kind_and_occurred_at", ["transport.delivery.kind", "occurredAt"])
    .index("by_inbox_and_delivery_kind_and_occurred_at", [
      "inboxId",
      "transport.delivery.kind",
      "occurredAt",
    ])
    .index("by_parse_kind_and_occurred_at", ["transport.parse.kind", "occurredAt"])
    .index("by_inbox_and_parse_kind_and_occurred_at", [
      "inboxId",
      "transport.parse.kind",
      "occurredAt",
    ])
    .index("by_thread_and_occurred_at", ["threadId", "occurredAt"])
    .index("by_inbox_and_rfc_message_id", ["inboxId", "rfcMessageId"])
    .index("by_inbox_and_client_request_id", ["inboxId", "clientRequestId"]),
  emailBodies: defineTable({
    messageId: v.id("emailMessages"),
    content: v.string(),
    html: v.optional(v.string()),
    originalByteCount: v.number(),
    truncated: v.boolean(),
  }).index("by_message", ["messageId"]),
  emailAttachments: defineTable({
    messageId: v.id("emailMessages"),
    ordinal: v.number(),
    r2Key: v.string(),
    originalFilename: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    sha256: v.optional(v.string()),
  }).index("by_message_and_ordinal", ["messageId", "ordinal"]),
});
