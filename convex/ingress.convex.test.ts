/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/*.js",
  "!./**/*.test.ts",
  "!./**/*.convex.test.ts",
]);

async function createInbox(t: TestConvex<typeof schema>, localPart: string) {
  return await t.run(async (ctx) => {
    let domain = await ctx.db
      .query("mailDomains")
      .withIndex("by_domain", (q) => q.eq("domain", "json.md"))
      .unique();
    if (!domain) {
      const domainId = await ctx.db.insert("mailDomains", {
        domain: "json.md",
        createdAt: 1,
      });
      domain = await ctx.db.get(domainId);
    }
    if (!domain) {
      throw new Error("Domain setup failed");
    }
    return await ctx.db.insert("inboxes", {
      domainId: domain._id,
      localPart,
      address: `${localPart}@json.md`,
      label: localPart,
      unreadCount: 0,
      createdAt: 1,
    });
  });
}

function completion(
  recipient: string,
  ingressKey: string,
  overrides?: { inReplyTo: string | null },
) {
  return {
    recipient,
    ingressKey,
    parse: { kind: "parsed" as const },
    headerFrom: "Sender <sender@example.com>",
    replyToAddress: "sender@example.com",
    headerTo: [recipient],
    headerCc: [],
    rfcMessageId: `<${ingressKey.slice(0, 12)}@example.com>`,
    inReplyTo: overrides?.inReplyTo ?? null,
    references: overrides?.inReplyTo ? [overrides.inReplyTo] : [],
    subject: "One subject",
    snippet: "Message text",
    occurredAt: 2,
    bodies: [
      {
        content: "Message text",
        originalByteCount: 12,
        truncated: false,
      },
    ],
    attachments: [],
  };
}

async function reserve(t: TestConvex<typeof schema>, recipient: string, ingressKey: string) {
  return await t.mutation(internal.ingress.begin, {
    recipient,
    ingressKey,
    envelopeFrom: "sender@example.com",
    rawSize: 100,
    receivedAt: 1,
  });
}

describe("mail ingress", () => {
  it("rejects an unknown recipient before storage", async () => {
    const t = convexTest(schema, modules);

    await expect(reserve(t, "missing@json.md", "a".repeat(64))).resolves.toEqual({
      kind: "reject",
      reason: "unknown",
    });
  });

  it("commits one message for repeated delivery", async () => {
    const t = convexTest(schema, modules);
    await createInbox(t, "inbox");
    const ingressKey = "b".repeat(64);

    await reserve(t, "inbox@json.md", ingressKey);
    const first = await t.mutation(
      internal.ingress.complete,
      completion("inbox@json.md", ingressKey),
    );
    const secondReservation = await reserve(t, "inbox@json.md", ingressKey);
    const second = await t.mutation(
      internal.ingress.complete,
      completion("inbox@json.md", ingressKey),
    );

    expect(first.kind).toBe("committed");
    expect(secondReservation).toEqual({ kind: "duplicate" });
    expect(second).toEqual({ kind: "duplicate", messageId: first.messageId });
    const counts = await t.run(async (ctx) => ({
      messages: (await ctx.db.query("emailMessages").collect()).length,
      threads: (await ctx.db.query("emailThreads").collect()).length,
      unread: (await ctx.db.query("inboxes").first())?.unreadCount,
    }));
    expect(counts).toEqual({ messages: 1, threads: 1, unread: 1 });
  });

  it("keeps equal subjects separate unless reference headers connect them", async () => {
    const t = convexTest(schema, modules);
    await createInbox(t, "notes");
    const firstKey = "c".repeat(64);
    const secondKey = "d".repeat(64);
    const replyKey = "e".repeat(64);

    await reserve(t, "notes@json.md", firstKey);
    const first = await t.mutation(
      internal.ingress.complete,
      completion("notes@json.md", firstKey),
    );
    await reserve(t, "notes@json.md", secondKey);
    await t.mutation(internal.ingress.complete, completion("notes@json.md", secondKey));
    await reserve(t, "notes@json.md", replyKey);
    await t.mutation(
      internal.ingress.complete,
      completion("notes@json.md", replyKey, {
        inReplyTo: `<${firstKey.slice(0, 12)}@example.com>`,
      }),
    );

    const result = await t.run(async (ctx) => {
      const firstMessage = await ctx.db.get(first.messageId);
      if (!firstMessage) {
        throw new Error("First message not found");
      }
      const reply = await ctx.db
        .query("emailMessages")
        .withIndex("by_inbox_and_rfc_message_id", (q) =>
          q
            .eq("inboxId", firstMessage.inboxId)
            .eq("rfcMessageId", `<${replyKey.slice(0, 12)}@example.com>`),
        )
        .first();
      return {
        threads: await ctx.db.query("emailThreads").collect(),
        firstMessage,
        reply,
      };
    });
    expect(result.threads).toHaveLength(2);
    expect(result.reply?.threadId).toBe(result.firstMessage?.threadId);
  });
});
