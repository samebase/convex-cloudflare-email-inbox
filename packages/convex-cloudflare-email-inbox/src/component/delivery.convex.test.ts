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
import { verifyObjectGrant } from "../r2";

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
  const claim = async () => {
    const prepared = await t.query(internal.delivery.prepare, { messageId });
    return prepared ? await t.mutation(internal.delivery.claim, { messageId, prepared }) : null;
  };
  return { messageId, t, claim };
}

describe("outbound delivery state", () => {
  // queued -> sending -> accepted, rejected, or unknown. A confirmed 429 may
  // return to queued. Only the current attempt can finish or trigger its watchdog.
  it("allows only one claim for a queued message", async () => {
    const { messageId, t } = await queuedMessage();
    const prepared = await t.query(internal.delivery.prepare, { messageId });
    if (!prepared) throw new Error("Missing prepared message");
    const first = await t.mutation(internal.delivery.claim, { messageId, prepared });
    const second = await t.mutation(internal.delivery.claim, { messageId, prepared });

    expect(prepared.payload).toMatchObject({ from: "inbox@json.md", text: "Body" });
    expect(first).toBe(1);
    expect(second).toBeNull();
  });

  it("keeps an uncertain send terminal until a manual new request", async () => {
    const { messageId, t, claim } = await queuedMessage();
    await claim();

    await t.mutation(internal.delivery.finish, {
      messageId,
      attempt: 1,
      outcome: { kind: "unknown" },
    });
    const repeatClaim = await claim();
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(repeatClaim).toBeNull();
    expect(message?.transport).toMatchObject({
      kind: "outbound",
      delivery: { kind: "unknown" },
    });
  });

  it("marks a stranded sending state unknown without retrying it", async () => {
    const { messageId, t, claim } = await queuedMessage();
    await claim();

    await t.mutation(internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt: Date.now(),
      attempt: 1,
    });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(message?.transport).toMatchObject({
      kind: "outbound",
      delivery: { kind: "unknown" },
    });
  });

  it("retains a conclusive receipt after the watchdog without allowing another send", async () => {
    const { messageId, t, claim } = await queuedMessage();
    await claim();
    await t.mutation(internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt: Date.now(),
      attempt: 1,
    });
    expect(await claim()).toBeNull();

    await t.mutation(internal.delivery.finish, {
      messageId,
      attempt: 1,
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
    expect(await claim()).toBeNull();
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

  it.each([400, 408, 500])("persists HTTP %s without resending", async (status) => {
    const { messageId, t } = await queuedMessage();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(cloudflareSendRejection, { status }));
    vi.stubGlobal("fetch", request);

    const result = await t.action(api.delivery.send, { messageId });
    await t.action(api.delivery.send, { messageId });

    expect(result).toMatchObject(
      status === 400 ? { kind: "rejected", code: "cloudflare_10001" } : { kind: "unknown" },
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not send while another action owns the claim", async () => {
    const { messageId, t, claim } = await queuedMessage();
    await claim();
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);

    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({ kind: "sending" });
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves accepted messages created before REST recipient results", async () => {
    const { messageId, t, claim } = await queuedMessage();
    await claim();
    await t.mutation(internal.delivery.finish, {
      messageId,
      attempt: 1,
      outcome: { kind: "accepted", providerMessageId: "opaque-provider-id" },
    });

    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({
      kind: "accepted",
      providerMessageId: "opaque-provider-id",
    });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(message?.rfcMessageId).toBeUndefined();
    expect(await claim()).toBeNull();
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

  it("retries only three times after confirmed throttling and blocks early replays", async () => {
    const { messageId, t } = await queuedMessage();
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json(cloudflareSendRejection, { status: 429, headers: { "Retry-After": "30" } }),
      );
    vi.stubGlobal("fetch", request);
    const first = await t.action(api.delivery.send, { messageId });
    expect(first).toEqual({ kind: "queued", queuedAt: Date.now(), notBefore: Date.now() + 30_000 });
    expect(await t.action(api.delivery.send, { messageId })).toEqual(first);
    expect(request).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    await t.finishInProgressScheduledFunctions();
    expect(request).toHaveBeenCalledTimes(2);
    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({ kind: "queued" });
    await vi.advanceTimersByTimeAsync(30_000);
    await t.finishInProgressScheduledFunctions();
    expect(request).toHaveBeenCalledTimes(3);
    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({
      kind: "rejected",
      code: "cloudflare_http_429",
    });
    await t.action(api.delivery.send, { messageId });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not let an earlier attempt finish or time out the next attempt", async () => {
    const { messageId, t, claim } = await queuedMessage();
    const firstStartedAt = Date.now();
    expect(await claim()).toBe(1);
    await t.mutation(internal.delivery.finish, {
      messageId,
      attempt: 1,
      outcome: { kind: "throttled", retryAt: Date.now() + 1_000 },
    });
    vi.setSystemTime(Date.now() + 1_000);
    expect(await claim()).toBe(2);
    await t.mutation(internal.delivery.markUnknownIfStale, {
      messageId,
      startedAt: firstStartedAt,
      attempt: 1,
    });
    await t.mutation(internal.delivery.finish, {
      messageId,
      attempt: 1,
      outcome: { kind: "accepted", providerMessageId: "stale-receipt" },
    });
    expect(await t.query(api.delivery.get, { messageId })).toEqual({
      kind: "sending",
      startedAt: Date.now(),
    });
  });

  it("rejects a Retry-After beyond the automatic retry horizon instead of sending early", async () => {
    const { messageId, t } = await queuedMessage();
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(cloudflareSendRejection, {
        status: 429,
        headers: { "Retry-After": "86401" },
      }),
    );
    vi.stubGlobal("fetch", request);
    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({
      kind: "rejected",
      code: "cloudflare_http_429",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("refuses a changed payload after preparation", async () => {
    const { messageId, t } = await queuedMessage();
    const prepared = await t.query(internal.delivery.prepare, { messageId });
    if (!prepared) throw new Error("Missing prepared message");
    await t.run(async (ctx) => await ctx.db.patch(messageId, { subject: "Changed" }));
    expect(await t.mutation(internal.delivery.claim, { messageId, prepared })).toBeNull();
    await t.mutation(internal.delivery.rejectPreparation, {
      messageId,
      prepared,
      code: "attachment_unavailable",
    });
    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({ kind: "queued" });
  });

  it("does not overwrite another sender's claim with a preparation failure", async () => {
    const { messageId, t, claim } = await queuedMessage();
    const prepared = await t.query(internal.delivery.prepare, { messageId });
    if (!prepared) throw new Error("Missing prepared message");
    await claim();
    await t.mutation(internal.delivery.rejectPreparation, {
      messageId,
      prepared,
      code: "attachment_unavailable",
    });
    expect(await t.query(api.delivery.get, { messageId })).toMatchObject({ kind: "sending" });
  });
});

describe("outbound R2 attachments", () => {
  async function messageWithAttachment() {
    const fixture = await queuedMessage();
    const bytes = new TextEncoder().encode("report");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const attachmentId = await fixture.t.run(
      async (ctx) =>
        await ctx.db.insert("emailAttachments", {
          messageId: fixture.messageId,
          ordinal: 1,
          r2Key: "outbound/report.txt",
          originalFilename: "report.txt",
          mimeType: "text/plain",
          byteSize: bytes.byteLength,
          sha256,
        }),
    );
    return { ...fixture, bytes, attachmentId };
  }

  beforeEach(() => {
    vi.stubEnv("MAIL_WORKER_URL", "https://mail.example.com");
    vi.stubEnv("MAIL_BRIDGE_SECRET", "test-bridge-secret");
  });

  it("loads a fresh signed object, checks its digest, then sends the complete payload", async () => {
    const { messageId, t, bytes } = await messageWithAttachment();
    await t.run(async (ctx) => {
      await ctx.db.patch(messageId, {
        headerBcc: ["private@example.com"],
        replyToAddress: "support@example.com",
      });
      const body = await ctx.db
        .query("emailBodies")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .first();
      if (!body) throw new Error("Missing body");
      await ctx.db.patch(body._id, { html: "<p>Body</p>" });
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(Response.json(cloudflareSendReceipt));
    vi.stubGlobal("fetch", request);

    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({ kind: "accepted" });
    expect(request).toHaveBeenCalledTimes(2);
    const [objectInput, objectOptions] = request.mock.calls[0];
    const objectUrl = new URL(new Request(objectInput, objectOptions).url);
    expect(objectUrl.origin + objectUrl.pathname).toBe("https://mail.example.com/api/mail/object");
    const grant = objectUrl.searchParams.get("grant");
    if (!grant) throw new Error("Missing object grant");
    expect(await verifyObjectGrant(grant, "test-bridge-secret")).toMatchObject({
      r2Key: "outbound/report.txt",
      expiresAt: Date.now() + 5 * 60_000,
    });
    const [providerInput, providerOptions] = request.mock.calls[1];
    expect(await new Request(providerInput, providerOptions).json()).toMatchObject({
      bcc: ["private@example.com"],
      reply_to: "support@example.com",
      html: "<p>Body</p>",
      attachments: [
        {
          content: btoa("report"),
          filename: "report.txt",
          type: "text/plain",
          disposition: "attachment",
        },
      ],
    });
  });

  it.each([
    ["report longer", "attachment_size_mismatch"],
    ["short", "attachment_size_mismatch"],
    ["edited", "attachment_digest_mismatch"],
  ])("rejects changed R2 content %s before a provider attempt", async (body, code) => {
    const { messageId, t } = await messageWithAttachment();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", request);
    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({
      kind: "rejected",
      code,
    });
    expect(request).toHaveBeenCalledOnce();
    expect((await t.run(async (ctx) => await ctx.db.get(messageId)))?.transport).toMatchObject({
      kind: "outbound",
      delivery: { kind: "rejected" },
    });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    if (message?.transport.kind !== "outbound") throw new Error("Missing outbound message");
    expect(message.transport.attempt).toBeUndefined();
  });

  it("rejects an oversized encoded message before fetching an object", async () => {
    const { messageId, t, attachmentId } = await messageWithAttachment();
    await t.run(async (ctx) => await ctx.db.patch(attachmentId, { byteSize: 5 * 1_024 * 1_024 }));
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({
      kind: "rejected",
      code: "message_too_large",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("treats a failed object read as unsent rather than unknown", async () => {
    const { messageId, t } = await messageWithAttachment();
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("R2 unavailable"));
    vi.stubGlobal("fetch", request);
    expect(await t.action(api.delivery.send, { messageId })).toMatchObject({
      kind: "rejected",
      code: "attachment_unavailable",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
