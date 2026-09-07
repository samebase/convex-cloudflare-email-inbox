/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/*.js",
  "!./**/*.test.ts",
  "!./**/*.convex.test.ts",
]);

async function queuedMessage() {
  const t = convexTest(schema, modules);
  const messageId = await t.run(async (ctx) => {
    const domainId = await ctx.db.insert("mailDomains", {
      domain: "json.md",
      createdAt: 1,
    });
    const inboxId = await ctx.db.insert("inboxes", {
      domainId,
      localPart: "inbox",
      address: "inbox@json.md",
      label: "Inbox",
      unreadCount: 0,
      createdAt: 1,
    });
    const threadId = await ctx.db.insert("emailThreads", {
      inboxId,
      subject: "Test",
      snippet: "Body",
      lastFrom: "inbox@json.md",
      lastActivityAt: 1,
      messageCount: 1,
      unreadCount: 0,
    });
    const id = await ctx.db.insert("emailMessages", {
      inboxId,
      threadId,
      envelopeFrom: "inbox@json.md",
      envelopeTo: "owner@example.com",
      headerFrom: "inbox@json.md",
      headerTo: ["owner@example.com"],
      headerCc: [],
      references: [],
      subject: "Test",
      snippet: "Body",
      occurredAt: 1,
      clientRequestId: "test-client-request-id",
      transport: {
        kind: "outbound",
        clientRequestId: "test-client-request-id",
        delivery: { kind: "queued", queuedAt: 1 },
      },
    });
    await ctx.db.insert("emailBodies", {
      messageId: id,
      content: "Body",
      originalByteCount: 4,
      truncated: false,
    });
    return id;
  });
  return { messageId, t };
}

describe("outbound delivery state", () => {
  it("allows only one claim for a queued message", async () => {
    const { messageId, t } = await queuedMessage();

    const first = await t.mutation(internal.delivery.claim, { messageId });
    const second = await t.mutation(internal.delivery.claim, { messageId });

    expect(first).toMatchObject({ from: "inbox@json.md", text: "Body" });
    expect(second).toBeNull();
  });

  it("keeps an uncertain send terminal until a manual new request", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(internal.delivery.claim, { messageId });

    await t.mutation(internal.delivery.finish, { messageId, outcome: { kind: "unknown" } });
    const repeatClaim = await t.mutation(internal.delivery.claim, { messageId });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(repeatClaim).toBeNull();
    expect(message?.transport).toMatchObject({
      kind: "outbound",
      delivery: { kind: "unknown" },
    });
  });

  it("marks a stranded sending state unknown without retrying it", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(internal.delivery.claim, { messageId });

    await t.mutation(internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt: Number.MAX_SAFE_INTEGER,
    });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(message?.transport).toMatchObject({
      kind: "outbound",
      delivery: { kind: "unknown" },
    });
  });
});
