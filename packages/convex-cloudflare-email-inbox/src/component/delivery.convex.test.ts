/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import {
  cloudflareSendReceipt,
  cloudflareSendRejection,
} from "../../tests/cloudflareEmail.fixtures";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/*.js",
  "!./**/*.test.ts",
  "!./**/*.convex.test.ts",
]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "test-token");
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "test-account");
  // The SDK's EdgeRuntime detection assumes process.version exists.
  vi.stubGlobal("EdgeRuntime", undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
      senderName: "Samebase",
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
  // queued -> sending -> accepted, rejected, or unknown. All terminal states
  // and a concurrent sending state reject another claim.
  it("allows only one claim for a queued message", async () => {
    const { messageId, t } = await queuedMessage();

    const first = await t.mutation(api.delivery.claim, { messageId });
    const second = await t.mutation(api.delivery.claim, { messageId });

    expect(first).toMatchObject({ from: "inbox@json.md", text: "Body" });
    expect(second).toBeNull();
  });

  it("keeps an uncertain send terminal until a manual new request", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(api.delivery.claim, { messageId });

    await t.mutation(api.delivery.finish, { messageId, outcome: { kind: "unknown" } });
    const repeatClaim = await t.mutation(api.delivery.claim, { messageId });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(repeatClaim).toBeNull();
    expect(message?.transport).toMatchObject({
      kind: "outbound",
      delivery: { kind: "unknown" },
    });
  });

  it("marks a stranded sending state unknown without retrying it", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(api.delivery.claim, { messageId });

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

  it("retains a conclusive receipt after the watchdog without allowing another send", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(api.delivery.claim, { messageId });
    await t.mutation(internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt: Number.MAX_SAFE_INTEGER,
    });
    expect(await t.mutation(api.delivery.claim, { messageId })).toBeNull();

    await t.mutation(api.delivery.finish, {
      messageId,
      outcome: {
        kind: "accepted",
        providerMessageId: cloudflareSendReceipt.result.message_id,
        recipientResults: {
          delivered: cloudflareSendReceipt.result.delivered,
          queued: cloudflareSendReceipt.result.queued,
          permanent_bounces: cloudflareSendReceipt.result.permanent_bounces,
          suppressed_recipients: cloudflareSendReceipt.result.suppressed_recipients,
        },
      },
    });

    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({
      kind: "accepted",
      providerMessageId: cloudflareSendReceipt.result.message_id,
      recipientResults: {
        delivered: cloudflareSendReceipt.result.delivered,
        queued: cloudflareSendReceipt.result.queued,
        permanent_bounces: cloudflareSendReceipt.result.permanent_bounces,
        suppressed_recipients: cloudflareSendReceipt.result.suppressed_recipients,
      },
    });
    expect(await t.mutation(api.delivery.claim, { messageId })).toBeNull();
  });

  it("stores the full REST receipt and does not send again on replay", async () => {
    const { messageId, t } = await queuedMessage();
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(cloudflareSendReceipt));
    vi.stubGlobal("fetch", request);
    await t.run(async (ctx) => await ctx.db.patch(messageId, { headerFrom: "display label" }));

    const result = await t.action(api.delivery.send, { messageId });
    const replay = await t.action(api.delivery.send, { messageId });
    const stored = await t.query(api.delivery.get, { messageId });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(result).toMatchObject({
      kind: "accepted",
      providerMessageId: cloudflareSendReceipt.result.message_id,
      recipientResults: {
        delivered: cloudflareSendReceipt.result.delivered,
        queued: cloudflareSendReceipt.result.queued,
        permanent_bounces: cloudflareSendReceipt.result.permanent_bounces,
        suppressed_recipients: cloudflareSendReceipt.result.suppressed_recipients,
      },
    });
    expect(replay).toEqual(result);
    expect(stored).toEqual(result);
    expect(message?.rfcMessageId).toBe(cloudflareSendReceipt.result.message_id);
    const [url, options] = request.mock.calls[0];
    const sentBody: unknown = await new Request(url, options).json();
    expect(sentBody).toMatchObject({ from: { address: "inbox@json.md", name: "Samebase" } });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([400, 500])("persists HTTP %s without resending", async (status) => {
    const { messageId, t } = await queuedMessage();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(cloudflareSendRejection, { status }));
    vi.stubGlobal("fetch", request);

    const result = await t.action(api.delivery.send, { messageId });
    await t.action(api.delivery.send, { messageId });

    expect(result).toMatchObject(
      status === 400 ? { kind: "rejected", code: "cloudflare_http_400" } : { kind: "unknown" },
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not send while another action owns the claim", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(api.delivery.claim, { messageId });
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);

    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({ kind: "sending" });
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves accepted messages created before REST recipient results", async () => {
    const { messageId, t } = await queuedMessage();
    await t.mutation(api.delivery.claim, { messageId });
    await t.mutation(api.delivery.finish, {
      messageId,
      outcome: { kind: "accepted", providerMessageId: "opaque-provider-id" },
    });

    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({
      kind: "accepted",
      providerMessageId: "opaque-provider-id",
    });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(message?.rfcMessageId).toBeUndefined();
    expect(await t.mutation(api.delivery.claim, { messageId })).toBeNull();
  });

  it("rejects a request ID replay with different content before creating another thread", async () => {
    const { messageId, t } = await queuedMessage();
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    if (!message) throw new Error("Missing fixture message");
    const args = {
      inboxId: message.inboxId,
      threadId: null,
      clientRequestId: "test-client-request-id",
      to: ["owner@example.com"],
      cc: [],
      subject: "Test",
      text: "Body",
      senderName: "Samebase",
      inReplyTo: null,
      references: [],
    };

    expect(await t.mutation(api.mail.queueSend, args)).toBe(messageId);
    await expect(
      t.mutation(api.mail.queueSend, { ...args, text: "Different body" }),
    ).rejects.toThrow("different message");
    const threads = await t.run(async (ctx) => await ctx.db.query("emailThreads").take(2));
    expect(threads).toHaveLength(1);
  });
});
