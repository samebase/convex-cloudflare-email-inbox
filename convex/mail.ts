import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { normalizeMailAddress } from "../shared/mailProtocol";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";

const threadSummary = v.object({
  _id: v.id("emailThreads"),
  inboxId: v.id("inboxes"),
  inboxAddress: v.string(),
  subject: v.string(),
  snippet: v.string(),
  lastFrom: v.string(),
  lastActivityAt: v.number(),
  messageCount: v.number(),
  unreadCount: v.number(),
});

const attachmentView = v.object({
  _id: v.id("emailAttachments"),
  filename: v.string(),
  mimeType: v.string(),
  byteSize: v.number(),
});

const messageView = v.object({
  _id: v.id("emailMessages"),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  status: v.union(
    v.literal("received"),
    v.literal("queued"),
    v.literal("sending"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("unknown"),
    v.literal("parse_failed"),
  ),
  from: v.string(),
  replyTo: v.union(v.string(), v.null()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  subject: v.string(),
  occurredAt: v.number(),
  rfcMessageId: v.union(v.string(), v.null()),
  references: v.array(v.string()),
  bodyText: v.string(),
  bodyTruncated: v.boolean(),
  rawAvailable: v.boolean(),
  attachments: v.array(attachmentView),
});

export const listThreads = query({
  args: {
    inboxId: v.union(v.id("inboxes"), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(threadSummary),
  handler: async (ctx, { inboxId, paginationOpts }) => {
    await requireOwner(ctx);
    const threadQuery = inboxId
      ? ctx.db
          .query("emailThreads")
          .withIndex("by_inbox_and_last_activity_at", (q) => q.eq("inboxId", inboxId))
      : ctx.db.query("emailThreads").withIndex("by_last_activity_at");
    const threads = await threadQuery.order("desc").paginate(paginationOpts);
    return {
      ...threads,
      page: await Promise.all(
        threads.page.map(async (thread) => {
          const inbox = await ctx.db.get(thread.inboxId);
          if (!inbox) {
            throw new Error("Thread inbox not found");
          }
          return {
            _id: thread._id,
            inboxId: thread.inboxId,
            inboxAddress: inbox.address,
            subject: thread.subject,
            snippet: thread.snippet,
            lastFrom: thread.lastFrom,
            lastActivityAt: thread.lastActivityAt,
            messageCount: thread.messageCount,
            unreadCount: thread.unreadCount,
          };
        }),
      ),
    };
  },
});

export const listMessages = query({
  args: {
    threadId: v.id("emailThreads"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(messageView),
  handler: async (ctx, { threadId, paginationOpts }) => {
    await requireOwner(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread_and_occurred_at", (q) => q.eq("threadId", threadId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...messages,
      page: await Promise.all(
        messages.page.map(async (message) => {
          const bodies = await ctx.db
            .query("emailBodies")
            .withIndex("by_message", (q) => q.eq("messageId", message._id))
            .take(1);
          const attachments = await ctx.db
            .query("emailAttachments")
            .withIndex("by_message_and_ordinal", (q) => q.eq("messageId", message._id))
            .take(200);
          const body = bodies[0];
          const status =
            message.transport.kind === "outbound"
              ? message.transport.delivery.kind
              : message.transport.parse.kind === "failed"
                ? ("parse_failed" as const)
                : ("received" as const);
          return {
            _id: message._id,
            direction: message.transport.kind,
            status,
            from: message.headerFrom || message.envelopeFrom,
            replyTo:
              message.transport.kind === "inbound"
                ? (message.replyToAddress ?? null)
                : message.envelopeTo,
            to: message.headerTo.length > 0 ? message.headerTo : [message.envelopeTo],
            cc: message.headerCc,
            subject: message.subject,
            occurredAt: message.occurredAt,
            rfcMessageId: message.rfcMessageId ?? null,
            references: message.references,
            bodyText: body?.content ?? "",
            bodyTruncated: Boolean(body?.truncated),
            rawAvailable: message.transport.kind === "inbound",
            attachments: attachments.map((attachment) => ({
              _id: attachment._id,
              filename: attachment.originalFilename,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            })),
          };
        }),
      ),
    };
  },
});

export const getThread = query({
  args: { threadId: v.id("emailThreads") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("emailThreads"),
      inboxId: v.id("inboxes"),
      inboxAddress: v.string(),
      subject: v.string(),
      messageCount: v.number(),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    await requireOwner(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return null;
    }
    const inbox = await ctx.db.get(thread.inboxId);
    if (!inbox) {
      throw new Error("Thread inbox not found");
    }
    return {
      _id: thread._id,
      inboxId: thread.inboxId,
      inboxAddress: inbox.address,
      subject: thread.subject,
      messageCount: thread.messageCount,
    };
  },
});

export const markThreadRead = mutation({
  args: { threadId: v.id("emailThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await requireOwner(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.unreadCount === 0) {
      return null;
    }
    const inbox = await ctx.db.get(thread.inboxId);
    await ctx.db.patch(threadId, { unreadCount: 0 });
    if (inbox) {
      await ctx.db.patch(inbox._id, {
        unreadCount: Math.max(0, inbox.unreadCount - thread.unreadCount),
      });
    }
    return null;
  },
});

export const queueSend = mutation({
  args: {
    inboxId: v.id("inboxes"),
    threadId: v.union(v.id("emailThreads"), v.null()),
    clientRequestId: v.string(),
    to: v.array(v.string()),
    cc: v.array(v.string()),
    subject: v.string(),
    text: v.string(),
    inReplyTo: v.union(v.string(), v.null()),
    references: v.array(v.string()),
  },
  returns: v.id("emailMessages"),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (args.clientRequestId.length < 16 || args.clientRequestId.length > 120) {
      throw new Error("Client request ID is invalid");
    }
    if (args.to.length < 1 || args.to.length + args.cc.length > 50) {
      throw new Error("Use between 1 and 50 recipients");
    }
    if (new TextEncoder().encode(args.text).byteLength > 524_288) {
      throw new Error("Message body is too large");
    }
    const inbox = await ctx.db.get(args.inboxId);
    if (!inbox) {
      throw new Error("Inbox does not exist");
    }
    const existing = await ctx.db
      .query("emailMessages")
      .withIndex("by_inbox_and_client_request_id", (q) =>
        q.eq("inboxId", args.inboxId).eq("clientRequestId", args.clientRequestId),
      )
      .unique();
    if (existing) {
      return existing._id;
    }
    const to = args.to.map(normalizeMailAddress);
    const cc = args.cc.map(normalizeMailAddress);
    const subject = args.subject.trim().slice(0, 998) || "(no subject)";
    const snippet = args.text.replace(/\s+/g, " ").trim().slice(0, 280);
    const occurredAt = Date.now();

    let thread = args.threadId ? await ctx.db.get(args.threadId) : null;
    if (thread && thread.inboxId !== inbox._id) {
      throw new Error("Thread does not belong to this inbox");
    }
    if (!thread) {
      const threadId = await ctx.db.insert("emailThreads", {
        inboxId: inbox._id,
        subject,
        snippet,
        lastFrom: inbox.address,
        lastActivityAt: occurredAt,
        messageCount: 0,
        unreadCount: 0,
      });
      thread = await ctx.db.get(threadId);
    }
    if (!thread) {
      throw new Error("Could not create thread");
    }
    const messageId = await ctx.db.insert("emailMessages", {
      inboxId: inbox._id,
      threadId: thread._id,
      envelopeFrom: inbox.address,
      envelopeTo: to[0],
      headerFrom: inbox.address,
      headerTo: to,
      headerCc: cc,
      ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}),
      references: args.references.slice(-20),
      subject,
      snippet,
      occurredAt,
      clientRequestId: args.clientRequestId,
      transport: {
        kind: "outbound",
        clientRequestId: args.clientRequestId,
        delivery: { kind: "queued", queuedAt: occurredAt },
      },
    });
    await ctx.db.insert("emailBodies", {
      messageId,
      content: args.text,
      originalByteCount: new TextEncoder().encode(args.text).byteLength,
      truncated: false,
    });
    await ctx.db.patch(thread._id, {
      subject,
      snippet,
      lastFrom: inbox.address,
      lastActivityAt: occurredAt,
      messageCount: thread.messageCount + 1,
    });
    await ctx.scheduler.runAfter(0, internal.delivery.send, { messageId });
    return messageId;
  },
});
