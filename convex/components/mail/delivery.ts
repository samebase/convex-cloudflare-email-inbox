import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";

const SEND_WATCHDOG_DELAY_MS = 60_000;

const sendPayload = v.object({
  from: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  subject: v.string(),
  text: v.string(),
  inReplyTo: v.union(v.string(), v.null()),
  references: v.array(v.string()),
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
      from: message.headerFrom,
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
    outcome: v.union(
      v.object({ kind: v.literal("accepted"), providerMessageId: v.string() }),
      v.object({ kind: v.literal("rejected"), code: v.string() }),
      v.object({ kind: v.literal("unknown") }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, outcome }) => {
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.transport.kind !== "outbound" ||
      message.transport.delivery.kind !== "sending"
    ) {
      return null;
    }
    const observedAt = Date.now();
    if (outcome.kind === "accepted") {
      await ctx.db.patch(messageId, {
        rfcMessageId: outcome.providerMessageId,
        transport: {
          ...message.transport,
          delivery: {
            kind: "accepted",
            acceptedAt: observedAt,
            providerMessageId: outcome.providerMessageId,
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
