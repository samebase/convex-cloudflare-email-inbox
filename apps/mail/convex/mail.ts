import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";

const threadSummary = v.object({
  _id: v.string(),
  inboxId: v.string(),
  inboxAddress: v.string(),
  subject: v.string(),
  snippet: v.string(),
  lastFrom: v.string(),
  lastActivityAt: v.number(),
  messageCount: v.number(),
  unreadCount: v.number(),
});

const attachmentView = v.object({
  _id: v.string(),
  filename: v.string(),
  mimeType: v.string(),
  byteSize: v.number(),
});

const messageView = v.object({
  _id: v.string(),
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
    inboxId: v.union(v.string(), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(threadSummary),
  handler: async (ctx, { inboxId, paginationOpts }) => {
    await requireOwner(ctx);
    return await ctx.runQuery(components.mail.mail.listThreads, {
      inboxId,
      paginationOpts,
    });
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(messageView),
  handler: async (ctx, { threadId, paginationOpts }) => {
    await requireOwner(ctx);
    return await ctx.runQuery(components.mail.mail.listMessages, {
      threadId,
      paginationOpts,
    });
  },
});

export const getThread = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.string(),
      inboxId: v.string(),
      inboxAddress: v.string(),
      subject: v.string(),
      messageCount: v.number(),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    await requireOwner(ctx);
    return await ctx.runQuery(components.mail.mail.getThread, { threadId });
  },
});

export const markThreadRead = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await requireOwner(ctx);
    return await ctx.runMutation(components.mail.mail.markThreadRead, { threadId });
  },
});

export const queueSend = mutation({
  args: {
    inboxId: v.string(),
    threadId: v.union(v.string(), v.null()),
    clientRequestId: v.string(),
    to: v.array(v.string()),
    cc: v.array(v.string()),
    subject: v.string(),
    text: v.string(),
    inReplyTo: v.union(v.string(), v.null()),
    references: v.array(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await new EmailInbox(components.mail).enqueue(ctx, {
      inboxId: args.inboxId,
      threadId: args.threadId,
      clientRequestId: args.clientRequestId,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      text: args.text,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
  },
});
