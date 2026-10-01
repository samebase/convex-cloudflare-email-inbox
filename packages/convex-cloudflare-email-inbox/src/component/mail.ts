import { paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { normalizeMailAddress } from "./mailProtocol";
import { messageContentFields, outboundAttachment } from "./messageTypes";
import schema from "./schema";
import { plainTextFromHtml } from "./text";

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
  inboxId: v.id("inboxes"),
  threadId: v.id("emailThreads"),
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
  attachments: v.array(attachmentView),
});

async function readMessage(ctx: QueryCtx, message: Doc<"emailMessages">) {
  const body = await ctx.db
    .query("emailBodies")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .first();
  const attachments = await ctx.db
    .query("emailAttachments")
    .withIndex("by_message_and_ordinal", (q) => q.eq("messageId", message._id))
    .take(200);
  const status =
    message.transport.kind === "outbound"
      ? message.transport.delivery.kind
      : message.transport.parse.kind === "failed"
        ? ("parse_failed" as const)
        : ("received" as const);
  return {
    _id: message._id,
    inboxId: message.inboxId,
    threadId: message.threadId,
    direction: message.transport.kind,
    status,
    from: message.headerFrom || message.envelopeFrom,
    replyTo: message.replyToAddress ?? null,
    replyRecipient:
      message.transport.kind === "inbound"
        ? (message.replyToAddress ?? (message.envelopeFrom || null))
        : message.envelopeTo,
    to: message.headerTo,
    cc: message.headerCc,
    bcc: message.headerBcc ?? [],
    subject: message.subject,
    occurredAt: message.occurredAt,
    rfcMessageId: message.rfcMessageId ?? null,
    references: message.references,
    bodyText: body?.content || (body?.html ? plainTextFromHtml(body.html) : ""),
    bodyHtml: body?.html ?? null,
    bodyTruncated: Boolean(body?.truncated),
    rawAvailable: message.transport.kind === "inbound",
    attachments: attachments.map((attachment) => ({
      _id: attachment._id,
      filename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
    })),
  };
}

export const getMessage = query({
  args: { messageId: v.id("emailMessages") },
  returns: v.union(v.null(), messageView),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    return message ? await readMessage(ctx, message) : null;
  },
});

export const listThreads = query({
  args: {
    inboxId: v.union(v.id("inboxes"), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(threadSummary),
  handler: async (ctx, { inboxId, paginationOpts }) => {
    const threadQuery = inboxId
      ? paginator(ctx.db, schema)
          .query("emailThreads")
          .withIndex("by_inbox_and_last_activity_at", (q) => q.eq("inboxId", inboxId))
      : paginator(ctx.db, schema)
          .query("emailThreads")
          .withIndex("by_last_activity_at", (q) => q);
    const threads = await threadQuery.order("desc").paginate(paginationOpts);
    return {
      isDone: threads.isDone,
      continueCursor: threads.continueCursor,
      ...(threads.pageStatus ? { pageStatus: threads.pageStatus } : {}),
      ...(threads.splitCursor ? { splitCursor: threads.splitCursor } : {}),
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
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    const messages = await paginator(ctx.db, schema)
      .query("emailMessages")
      .withIndex("by_thread_and_occurred_at", (q) => q.eq("threadId", threadId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      isDone: messages.isDone,
      continueCursor: messages.continueCursor,
      ...(messages.pageStatus ? { pageStatus: messages.pageStatus } : {}),
      ...(messages.splitCursor ? { splitCursor: messages.splitCursor } : {}),
      page: await Promise.all(messages.page.map((message) => readMessage(ctx, message))),
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

const queueSendArgs = v.object({
  inboxId: v.optional(v.id("inboxes")),
  from: v.optional(v.string()),
  threadId: v.union(v.id("emailThreads"), v.null()),
  clientRequestId: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  bcc: v.optional(v.array(v.string())),
  replyTo: v.optional(v.string()),
  subject: v.string(),
  text: v.string(),
  html: v.optional(v.string()),
  attachments: v.optional(v.array(outboundAttachment)),
  senderName: v.optional(v.string()),
  inReplyTo: v.union(v.string(), v.null()),
  replyToMessageId: v.optional(v.id("emailMessages")),
  references: v.array(v.string()),
});

async function queueMessage(ctx: MutationCtx, args: Infer<typeof queueSendArgs>) {
  if (!args.clientRequestId.trim() || args.clientRequestId.length > 120) {
    throw new Error("Idempotency key must contain 1 to 120 characters");
  }
  if (args.to.length < 1 || args.to.length + args.cc.length + (args.bcc?.length ?? 0) > 50) {
    throw new Error("Use between 1 and 50 recipients");
  }
  if (!args.text.trim() && !args.html?.trim()) {
    throw new Error("A text or HTML body is required");
  }
  if (new TextEncoder().encode(args.text + (args.html ?? "")).byteLength > 524_288) {
    throw new Error("Message body is too large");
  }
  const from = args.from === undefined ? null : normalizeMailAddress(args.from);
  const inbox = args.inboxId
    ? await ctx.db.get(args.inboxId)
    : from
      ? await ctx.db
          .query("inboxes")
          .withIndex("by_address", (q) => q.eq("address", from))
          .unique()
      : null;
  if (!inbox) {
    throw new Error("Inbox does not exist");
  }
  if (from && inbox.address !== from) throw new Error("Sender does not match this inbox");
  const to = args.to.map(normalizeMailAddress);
  const cc = args.cc.map(normalizeMailAddress);
  const bcc = (args.bcc ?? []).map(normalizeMailAddress);
  const replyTo = args.replyTo === undefined ? undefined : normalizeMailAddress(args.replyTo);
  const html = args.html || undefined;
  const attachments = args.attachments ?? [];
  if (attachments.length > 32) throw new Error("Use at most 32 attachments");
  for (const file of attachments) {
    if (
      Array.from(file.r2Key + file.filename).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !file.r2Key ||
      file.r2Key.length > 1_024 ||
      !file.filename ||
      file.filename.length > 512 ||
      /[/\\]/.test(file.filename) ||
      !file.contentType ||
      file.contentType.length > 255 ||
      /[\r\n]/.test(file.contentType) ||
      !Number.isSafeInteger(file.byteSize) ||
      file.byteSize < 0 ||
      file.byteSize > 5 * 1_024 * 1_024 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error("Attachment reference is invalid");
    }
  }
  if (/[\r\n]/.test(args.subject)) throw new Error("Subject must be a single line");
  const subject = args.subject.trim().slice(0, 998) || "(no subject)";
  const references = args.references.slice(-20);
  const senderName = args.senderName?.trim();
  if (
    args.senderName !== undefined &&
    (!senderName || senderName.length > 255 || /[\r\n]/.test(senderName))
  ) {
    throw new Error("Sender name is invalid");
  }
  const existing = await ctx.db
    .query("emailMessages")
    .withIndex("by_inbox_and_client_request_id", (q) =>
      q.eq("inboxId", inbox._id).eq("clientRequestId", args.clientRequestId),
    )
    .unique();
  if (existing) {
    const bodies = await ctx.db
      .query("emailBodies")
      .withIndex("by_message", (q) => q.eq("messageId", existing._id))
      .take(1);
    const storedAttachments = await ctx.db
      .query("emailAttachments")
      .withIndex("by_message_and_ordinal", (q) => q.eq("messageId", existing._id))
      .take(200);
    const sameAttachments =
      attachments.length === storedAttachments.length &&
      attachments.every((file, index) => {
        const stored = storedAttachments[index];
        return (
          file.r2Key === stored.r2Key &&
          file.filename === stored.originalFilename &&
          file.contentType === stored.mimeType &&
          file.byteSize === stored.byteSize &&
          file.sha256 === stored.sha256
        );
      });
    if (
      existing.transport.kind !== "outbound" ||
      (args.threadId && existing.threadId !== args.threadId) ||
      JSON.stringify(existing.headerTo) !== JSON.stringify(to) ||
      JSON.stringify(existing.headerCc) !== JSON.stringify(cc) ||
      JSON.stringify(existing.headerBcc ?? []) !== JSON.stringify(bcc) ||
      existing.replyToAddress !== replyTo ||
      existing.subject !== subject ||
      bodies[0]?.content !== args.text ||
      bodies[0]?.html !== html ||
      !sameAttachments ||
      (!args.replyToMessageId && (existing.inReplyTo ?? null) !== (args.inReplyTo || null)) ||
      existing.replyToMessageId !== args.replyToMessageId ||
      (!args.replyToMessageId &&
        JSON.stringify(existing.references) !== JSON.stringify(references)) ||
      existing.senderName !== senderName
    ) {
      throw new Error("Idempotency key was already used for a different message");
    }
    return existing._id;
  }
  const snippet = (args.text || (html ? plainTextFromHtml(html) : ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  const occurredAt = Date.now();

  let thread = args.threadId ? await ctx.db.get(args.threadId) : null;
  if (args.threadId && !thread) throw new Error("Thread not found");
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
    ...(senderName ? { senderName } : {}),
    headerTo: to,
    headerCc: cc,
    headerBcc: bcc,
    ...(replyTo ? { replyToAddress: replyTo } : {}),
    ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}),
    ...(args.replyToMessageId ? { replyToMessageId: args.replyToMessageId } : {}),
    references,
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
    ...(html ? { html } : {}),
    originalByteCount: new TextEncoder().encode(args.text).byteLength,
    truncated: false,
  });
  for (const [index, file] of attachments.entries()) {
    await ctx.db.insert("emailAttachments", {
      messageId,
      ordinal: index + 1,
      r2Key: file.r2Key,
      originalFilename: file.filename,
      mimeType: file.contentType,
      byteSize: file.byteSize,
      sha256: file.sha256,
    });
  }
  await ctx.db.patch(thread._id, {
    subject,
    snippet,
    lastFrom: inbox.address,
    lastActivityAt: occurredAt,
    messageCount: thread.messageCount + 1,
  });
  return messageId;
}

export const queueSend = mutation({
  args: queueSendArgs,
  returns: v.id("emailMessages"),
  handler: queueMessage,
});

export const queueReply = mutation({
  args: {
    ...messageContentFields,
    messageId: v.id("emailMessages"),
    to: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
  },
  returns: v.id("emailMessages"),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get(args.messageId);
    if (!parent) throw new Error("Reply message not found");
    const recipient = parent.replyToAddress || parent.envelopeFrom;
    const to =
      args.to ??
      (parent.transport.kind === "outbound" ? parent.headerTo : recipient ? [recipient] : []);
    return await queueMessage(ctx, {
      inboxId: parent.inboxId,
      threadId: parent.threadId,
      clientRequestId: args.idempotencyKey,
      to,
      cc: args.cc ?? [],
      bcc: args.bcc ?? [],
      subject:
        args.subject ?? (/^re:/i.test(parent.subject) ? parent.subject : `Re: ${parent.subject}`),
      text: args.text ?? "",
      ...(args.html === undefined ? {} : { html: args.html }),
      ...(args.replyTo === undefined ? {} : { replyTo: args.replyTo }),
      attachments: args.attachments ?? [],
      inReplyTo: parent.rfcMessageId ?? null,
      replyToMessageId: parent._id,
      references: parent.rfcMessageId
        ? [...parent.references, parent.rfcMessageId]
        : parent.references,
    });
  },
});
