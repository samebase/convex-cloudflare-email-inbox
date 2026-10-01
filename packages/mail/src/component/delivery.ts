import { Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, env, internalMutation, mutation, query } from "./_generated/server";
import { safeRfcMessageId, sendCloudflareEmail, sendOutcome, sendPayload } from "./cloudflareEmail";
import { deliveryState } from "./schema";

const SEND_WATCHDOG_DELAY_MS = 60_000;

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

export const claim = mutation({
  args: { messageId: v.id("emailMessages") },
  returns: v.union(v.null(), sendPayload),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.transport.kind !== "outbound" ||
      message.transport.delivery.kind !== "queued"
    ) {
      return null;
    }
    const bodies = await ctx.db
      .query("emailBodies")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .take(1);
    const startedAt = Date.now();
    await ctx.db.patch(messageId, {
      transport: {
        ...message.transport,
        delivery: { kind: "sending", startedAt },
      },
    });
    await ctx.scheduler.runAfter(SEND_WATCHDOG_DELAY_MS, internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt,
    });
    return {
      from: message.envelopeFrom,
      ...(message.senderName ? { senderName: message.senderName } : {}),
      to: message.headerTo,
      cc: message.headerCc,
      subject: message.subject,
      text: bodies[0]?.content ?? "",
      inReplyTo: message.inReplyTo ?? null,
      references: message.references,
    };
  },
});

export const markUnknownIfStale = internalMutation({
  args: { messageId: v.id("emailMessages"), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { messageId, startedAt }) => {
    const message = await ctx.db.get(messageId);
    if (
      message?.transport.kind === "outbound" &&
      message.transport.delivery.kind === "sending" &&
      message.transport.delivery.startedAt <= startedAt
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

export const finish = mutation({
  args: {
    messageId: v.id("emailMessages"),
    outcome: sendOutcome,
  },
  returns: v.null(),
  handler: async (ctx, { messageId, outcome }) => {
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.transport.kind !== "outbound" ||
      (message.transport.delivery.kind !== "sending" &&
        (message.transport.delivery.kind !== "unknown" || outcome.kind === "unknown"))
    ) {
      return null;
    }
    const observedAt = Date.now();
    if (outcome.kind === "accepted") {
      const rfcMessageId = safeRfcMessageId(outcome.providerMessageId);
      await ctx.db.patch(messageId, {
        ...(rfcMessageId ? { rfcMessageId } : {}),
        transport: {
          ...message.transport,
          delivery: {
            kind: "accepted",
            acceptedAt: observedAt,
            providerMessageId: outcome.providerMessageId,
            ...(outcome.recipientResults ? { recipientResults: outcome.recipientResults } : {}),
          },
        },
      });
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
    const payload: Infer<typeof sendPayload> | null = await ctx.runMutation(api.delivery.claim, {
      messageId,
    });
    if (payload) {
      const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
      const accountId = env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
      const outcome =
        apiToken && accountId
          ? await sendCloudflareEmail({ apiToken, accountId, payload })
          : { kind: "rejected" as const, code: "email_not_configured" };
      await ctx.runMutation(api.delivery.finish, { messageId, outcome });
    }
    return await ctx.runQuery(api.delivery.get, { messageId });
  },
});
