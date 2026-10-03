import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { EmailInbox, replyOptions, sendOptions } from "@samebase/convex-cloudflare-email-inbox";
import { messageView } from "@samebase/convex-cloudflare-email-inbox/monitor";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";

const email = new EmailInbox(components.mail);

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

export const listThreads = query({
  args: {
    inboxId: v.union(v.string(), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(threadSummary),
  handler: async (ctx, { inboxId, paginationOpts }) => {
    await requireOwner(ctx);
    return await email.listThreads(ctx, {
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
    return await email.listMessages(ctx, {
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
    return await email.getThread(ctx, { threadId });
  },
});

export const markThreadRead = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await requireOwner(ctx);
    return await email.markThreadRead(ctx, { threadId });
  },
});

export const queueSend = mutation({
  args: sendOptions,
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await email.enqueue(ctx, args);
  },
});

export const reply = mutation({
  args: replyOptions,
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await email.reply(ctx, args);
  },
});
