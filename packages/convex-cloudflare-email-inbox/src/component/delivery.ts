import { compareValues, type Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  env,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { safeRfcMessageId, sendCloudflareEmail, sendOutcome, sendPayload } from "./cloudflareEmail";
import { loadOutboundAttachments } from "./outboundAttachments";
import { deliveryState } from "./schema";

const SEND_WATCHDOG_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60_000;

const preparedSend = v.object({ attempt: v.number(), payload: sendPayload });

async function loadPayload(ctx: QueryCtx, message: Doc<"emailMessages">) {
  const body = await ctx.db
    .query("emailBodies")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .first();
  const attachments = await ctx.db
    .query("emailAttachments")
    .withIndex("by_message_and_ordinal", (q) => q.eq("messageId", message._id))
    .take(33);
  return {
    from: message.envelopeFrom,
    ...(message.senderName ? { senderName: message.senderName } : {}),
    to: message.headerTo,
    cc: message.headerCc,
    bcc: message.headerBcc ?? [],
    replyTo: message.replyToAddress ?? null,
    subject: message.subject,
    text: body?.content ?? "",
    html: body?.html ?? null,
    attachments: attachments.map((attachment) => ({
      r2Key: attachment.r2Key,
      filename: attachment.originalFilename,
      contentType: attachment.mimeType,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256 ?? "",
    })),
    inReplyTo: message.inReplyTo ?? null,
    references: message.references,
  };
}

export const get = query({
  args: { messageId: v.id("emailMessages") },
  returns: deliveryState,
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.transport.kind !== "outbound") {
      throw new Error("Outbound message not found");
    }
    return message.transport.delivery;
  },
});

export const prepare = internalQuery({
  args: { messageId: v.id("emailMessages") },
  returns: v.union(v.null(), preparedSend),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.transport.kind !== "outbound" ||
      message.transport.delivery.kind !== "queued" ||
      (message.transport.delivery.notBefore ?? 0) > Date.now()
    ) {
      return null;
    }
    return { attempt: message.transport.attempt ?? 0, payload: await loadPayload(ctx, message) };
  },
});

export const claim = internalMutation({
  args: {
    messageId: v.id("emailMessages"),
    prepared: preparedSend,
  },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, { messageId, prepared }) => {
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.transport.kind !== "outbound" ||
      message.transport.delivery.kind !== "queued" ||
      (message.transport.delivery.notBefore ?? 0) > Date.now() ||
      (message.transport.attempt ?? 0) !== prepared.attempt ||
      compareValues(await loadPayload(ctx, message), prepared.payload) !== 0
    ) {
      return null;
    }
    const startedAt = Date.now();
    const attempt = prepared.attempt + 1;
    await ctx.db.patch(messageId, {
      transport: {
        ...message.transport,
        attempt,
        delivery: { kind: "sending", startedAt },
      },
    });
    await ctx.scheduler.runAfter(SEND_WATCHDOG_DELAY_MS, internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt,
      attempt,
    });
    return attempt;
  },
});

export const rejectPreparation = internalMutation({
  args: { messageId: v.id("emailMessages"), prepared: preparedSend, code: v.string() },
  returns: v.null(),
  handler: async (ctx, { messageId, prepared, code }) => {
    const message = await ctx.db.get(messageId);
    if (
      message?.transport.kind === "outbound" &&
      message.transport.delivery.kind === "queued" &&
      (message.transport.attempt ?? 0) === prepared.attempt &&
      compareValues(await loadPayload(ctx, message), prepared.payload) === 0
    ) {
      await ctx.db.patch(messageId, {
        transport: {
          ...message.transport,
          delivery: { kind: "rejected", failedAt: Date.now(), code },
        },
      });
    }
    return null;
  },
});

export const markUnknownIfStale = internalMutation({
  args: {
    messageId: v.id("emailMessages"),
    startedAt: v.number(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, startedAt, attempt }) => {
    const message = await ctx.db.get(messageId);
    if (
      message?.transport.kind === "outbound" &&
      (message.transport.attempt ?? 0) === (attempt ?? 0) &&
      message.transport.delivery.kind === "sending" &&
      message.transport.delivery.startedAt === startedAt
    ) {
      await ctx.db.patch(messageId, {
        transport: {
          ...message.transport,
          delivery: { kind: "unknown", observedAt: Date.now() },
        },
      });
    }
    return null;
  },
});

export const finish = internalMutation({
  args: { messageId: v.id("emailMessages"), attempt: v.number(), outcome: sendOutcome },
  returns: v.null(),
  handler: async (ctx, { messageId, attempt, outcome }) => {
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.transport.kind !== "outbound" ||
      (message.transport.attempt ?? 0) !== attempt ||
      (message.transport.delivery.kind !== "sending" &&
        (message.transport.delivery.kind !== "unknown" || outcome.kind === "unknown"))
    ) {
      return null;
    }
    const observedAt = Date.now();
    if (outcome.kind === "accepted") {
      const rfcMessageId = safeRfcMessageId(outcome.providerMessageId ?? null);
      await ctx.db.patch(messageId, {
        ...(rfcMessageId ? { rfcMessageId } : {}),
        transport: {
          ...message.transport,
          delivery: {
            kind: "accepted",
            acceptedAt: observedAt,
            ...(outcome.providerMessageId ? { providerMessageId: outcome.providerMessageId } : {}),
            ...(outcome.recipientResults ? { recipientResults: outcome.recipientResults } : {}),
          },
        },
      });
    } else if (outcome.kind === "throttled") {
      const notBefore = Math.max(observedAt + 1_000, outcome.retryAt);
      if (
        attempt < MAX_ATTEMPTS &&
        Number.isFinite(notBefore) &&
        notBefore - observedAt <= MAX_RETRY_DELAY_MS
      ) {
        await ctx.db.patch(messageId, {
          transport: {
            ...message.transport,
            delivery: { kind: "queued", queuedAt: observedAt, notBefore },
          },
        });
        await ctx.scheduler.runAt(notBefore, api.delivery.send, { messageId });
      } else {
        await ctx.db.patch(messageId, {
          transport: {
            ...message.transport,
            delivery: { kind: "rejected", failedAt: observedAt, code: "cloudflare_http_429" },
          },
        });
      }
    } else if (outcome.kind === "rejected") {
      await ctx.db.patch(messageId, {
        transport: {
          ...message.transport,
          delivery: { kind: "rejected", failedAt: observedAt, code: outcome.code },
        },
      });
    } else {
      await ctx.db.patch(messageId, {
        transport: {
          ...message.transport,
          delivery: { kind: "unknown", observedAt },
        },
      });
    }
    return null;
  },
});

export const send = action({
  args: { messageId: v.id("emailMessages") },
  returns: deliveryState,
  handler: async (ctx, { messageId }): Promise<Infer<typeof deliveryState>> => {
    const prepared: Infer<typeof preparedSend> | null = await ctx.runQuery(
      internal.delivery.prepare,
      {
        messageId,
      },
    );
    if (prepared) {
      const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
      const accountId = env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
      if (!apiToken || !accountId) {
        await ctx.runMutation(internal.delivery.rejectPreparation, {
          messageId,
          prepared: { attempt: prepared.attempt, payload: prepared.payload },
          code: "email_not_configured",
        });
        return await ctx.runQuery(api.delivery.get, { messageId });
      }
      const loaded = await loadOutboundAttachments(prepared.payload, {
        workerUrl: env.MAIL_WORKER_URL,
        secret: env.MAIL_BRIDGE_SECRET,
      });
      if (loaded.kind === "rejected") {
        await ctx.runMutation(internal.delivery.rejectPreparation, {
          messageId,
          prepared: { attempt: prepared.attempt, payload: prepared.payload },
          code: loaded.code,
        });
      } else {
        // Only the provider call is covered by the sending watchdog. File reads are still unsent.
        const attempt: number | null = await ctx.runMutation(internal.delivery.claim, {
          messageId,
          prepared: { attempt: prepared.attempt, payload: prepared.payload },
        });
        if (attempt !== null) {
          const outcome = await sendCloudflareEmail({
            apiToken,
            accountId,
            payload: prepared.payload,
            attachments: loaded.attachments,
          });
          await ctx.runMutation(internal.delivery.finish, { messageId, attempt, outcome });
        }
      }
    }
    return await ctx.runQuery(api.delivery.get, { messageId });
  },
});
