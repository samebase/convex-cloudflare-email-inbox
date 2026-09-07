import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const body = v.object({
  content: v.string(),
  originalByteCount: v.number(),
  truncated: v.boolean(),
});

const attachment = v.object({
  ordinal: v.number(),
  r2Key: v.string(),
  originalFilename: v.string(),
  mimeType: v.string(),
  byteSize: v.number(),
});

export const begin = internalMutation({
  args: {
    recipient: v.string(),
    ingressKey: v.string(),
    envelopeFrom: v.string(),
    rawSize: v.number(),
    receivedAt: v.number(),
  },
  returns: v.union(
    v.object({ kind: v.literal("ingest"), rawR2Key: v.string() }),
    v.object({ kind: v.literal("duplicate") }),
    v.object({
      kind: v.literal("reject"),
      reason: v.literal("unknown"),
    }),
  ),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_address", (q) => q.eq("address", args.recipient))
      .unique();
    if (!inbox) {
      return { kind: "reject" as const, reason: "unknown" as const };
    }
    const existing = await ctx.db
      .query("ingressReceipts")
      .withIndex("by_inbox_and_ingress_key", (q) =>
        q.eq("inboxId", inbox._id).eq("ingressKey", args.ingressKey),
      )
      .unique();
    if (existing?.state.kind === "committed") {
      return { kind: "duplicate" as const };
    }
    if (existing) {
      return { kind: "ingest" as const, rawR2Key: existing.rawR2Key };
    }
    const [localPart, domain] = inbox.address.split("@");
    if (!localPart || !domain) {
      throw new Error("Stored inbox address is invalid");
    }
    const rawR2Key = `mail/${domain}/${localPart}/messages/${args.ingressKey}/raw.eml`;
    await ctx.db.insert("ingressReceipts", {
      inboxId: inbox._id,
      ingressKey: args.ingressKey,
      rawR2Key,
      rawSize: args.rawSize,
      envelopeFrom: args.envelopeFrom,
      receivedAt: args.receivedAt,
      state: { kind: "reserved", reservedAt: Date.now() },
    });
    return { kind: "ingest" as const, rawR2Key };
  },
});

export const complete = internalMutation({
  args: {
    recipient: v.string(),
    ingressKey: v.string(),
    parse: v.union(
      v.object({ kind: v.literal("parsed") }),
      v.object({ kind: v.literal("failed"), code: v.string() }),
    ),
    headerFrom: v.string(),
    replyToAddress: v.union(v.string(), v.null()),
    headerTo: v.array(v.string()),
    headerCc: v.array(v.string()),
    rfcMessageId: v.union(v.string(), v.null()),
    inReplyTo: v.union(v.string(), v.null()),
    references: v.array(v.string()),
    subject: v.string(),
    snippet: v.string(),
    occurredAt: v.number(),
    bodies: v.array(body),
    attachments: v.array(attachment),
  },
  returns: v.union(
    v.object({ kind: v.literal("committed"), messageId: v.id("emailMessages") }),
    v.object({ kind: v.literal("duplicate"), messageId: v.id("emailMessages") }),
  ),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_address", (q) => q.eq("address", args.recipient))
      .unique();
    if (!inbox) {
      throw new Error("Inbox does not exist");
    }
    const receipt = await ctx.db
      .query("ingressReceipts")
      .withIndex("by_inbox_and_ingress_key", (q) =>
        q.eq("inboxId", inbox._id).eq("ingressKey", args.ingressKey),
      )
      .unique();
    if (!receipt) {
      throw new Error("Ingress was not reserved");
    }
    if (receipt.state.kind === "committed") {
      return { kind: "duplicate" as const, messageId: receipt.state.messageId };
    }
    const attachmentPrefix = `${receipt.rawR2Key.slice(0, -"raw.eml".length)}attachments/`;
    if (args.attachments.some((item) => !item.r2Key.startsWith(attachmentPrefix))) {
      throw new Error("Attachment storage key is outside this message");
    }

    let threadId;
    const relatedMessageIds = [args.inReplyTo, ...args.references.toReversed()].filter(
      (value) => typeof value === "string",
    );
    for (const relatedMessageId of relatedMessageIds) {
      const relatedMessage = await ctx.db
        .query("emailMessages")
        .withIndex("by_inbox_and_rfc_message_id", (q) =>
          q.eq("inboxId", inbox._id).eq("rfcMessageId", relatedMessageId),
        )
        .first();
      if (relatedMessage) {
        threadId = relatedMessage.threadId;
        break;
      }
    }
    if (!threadId) {
      threadId = await ctx.db.insert("emailThreads", {
        inboxId: inbox._id,
        subject: args.subject,
        snippet: args.snippet,
        lastFrom: args.headerFrom || receipt.envelopeFrom,
        lastActivityAt: args.occurredAt,
        messageCount: 0,
        unreadCount: 0,
      });
    }
    const messageId = await ctx.db.insert("emailMessages", {
      inboxId: inbox._id,
      threadId,
      envelopeFrom: receipt.envelopeFrom,
      envelopeTo: inbox.address,
      headerFrom: args.headerFrom,
      ...(args.replyToAddress ? { replyToAddress: args.replyToAddress } : {}),
      headerTo: args.headerTo,
      headerCc: args.headerCc,
      ...(args.rfcMessageId ? { rfcMessageId: args.rfcMessageId } : {}),
      ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}),
      references: args.references,
      subject: args.subject,
      snippet: args.snippet,
      occurredAt: args.occurredAt,
      transport: {
        kind: "inbound",
        rawR2Key: receipt.rawR2Key,
        parse: args.parse,
      },
    });
    for (const item of args.bodies) {
      await ctx.db.insert("emailBodies", { messageId, ...item });
    }
    for (const item of args.attachments) {
      await ctx.db.insert("emailAttachments", { messageId, ...item });
    }
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    const isLatestMessage = args.occurredAt >= thread.lastActivityAt;
    await ctx.db.patch(threadId, {
      ...(isLatestMessage
        ? {
            subject: args.subject || thread.subject,
            snippet: args.snippet,
            lastFrom: args.headerFrom || receipt.envelopeFrom,
            lastActivityAt: args.occurredAt,
          }
        : {}),
      messageCount: thread.messageCount + 1,
      unreadCount: thread.unreadCount + 1,
    });
    await ctx.db.patch(inbox._id, { unreadCount: inbox.unreadCount + 1 });
    await ctx.db.patch(receipt._id, {
      state: { kind: "committed", messageId, committedAt: Date.now() },
    });
    return { kind: "committed" as const, messageId };
  },
});
