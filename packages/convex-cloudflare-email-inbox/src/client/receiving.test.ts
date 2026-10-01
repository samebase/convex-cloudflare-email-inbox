/// <reference types="vite/client" />
import {
  defineSchema,
  httpRouter,
  internalActionGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { components } from "../../fixtures/consumer/_generated/api.js";
import { register } from "../test.js";
import {
  registerIngressRoutes,
  type IngressOptions,
  type MessageReceivedEvent,
} from "./receiving.js";

function receiver(
  secret: string | undefined = "bridge-secret",
  callback?: IngressOptions["onMessageReceived"],
  received = vi.fn(),
) {
  const http = httpRouter();
  registerIngressRoutes(http, components.mail, {
    secret: () => secret,
    ...(callback ? { onMessageReceived: callback } : {}),
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./http.ts": async () => ({ default: http }),
    "./hooks.ts": async () => ({
      received: internalActionGeneric({
        args: { messageId: v.string(), inboxId: v.string(), threadId: v.string() },
        returns: v.null(),
        handler: async (_ctx, event) => {
          received(event);
          return null;
        },
      }),
    }),
  });
  register(t);
  return t;
}

afterEach(() => vi.useRealTimers());

describe("authenticated ingress routes", () => {
  it.each(["begin", "complete"])(
    "rejects missing and wrong credentials before parsing %s",
    async (route) => {
      const t = receiver();
      for (const authorization of ["", "Bearer wrong-secret"]) {
        const response = await t.fetch(`/api/mail/ingress/${route}`, {
          method: "POST",
          headers: { authorization },
          body: "invalid json",
        });
        expect(response.status).toBe(401);
      }
      const unavailable = await receiver("").fetch(`/api/mail/ingress/${route}`, {
        method: "POST",
        headers: { authorization: "Bearer " },
        body: "{}",
      });
      expect(unavailable.status).toBe(401);
    },
  );

  it.each(["begin", "complete"])(
    "rejects malformed, invalid, and oversized JSON for %s",
    async (route) => {
      const t = receiver();
      for (const body of ["{", "{}"]) {
        const response = await t.fetch(`/api/mail/ingress/${route}`, {
          method: "POST",
          headers: { authorization: "Bearer bridge-secret" },
          body,
        });
        expect(response.status).toBe(400);
      }
      const tooLarge = await t.fetch(`/api/mail/ingress/${route}`, {
        method: "POST",
        headers: { authorization: "Bearer bridge-secret" },
        body: "x".repeat(4 * 1_024 * 1_024 + 1),
      });
      expect(tooLarge.status).toBe(413);
    },
  );

  it("routes valid requests into the registered component", async () => {
    const response = await receiver().fetch("/api/mail/ingress/begin", {
      method: "POST",
      headers: { authorization: "Bearer bridge-secret" },
      body: JSON.stringify({
        version: 1,
        recipient: "unknown@example.com",
        ingressKey: "a".repeat(64),
        envelopeFrom: "sender@example.com",
        rawSize: 12,
        receivedAt: 1,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "reject", reason: "unknown" });
  });

  it("commits through HTTP before dispatching the app callback and ignores a repeated completion", async () => {
    vi.useFakeTimers();
    const callback = makeFunctionReference<"action", MessageReceivedEvent, null>("hooks:received");
    const received = vi.fn();
    // @ts-expect-error The test module registers hooks:received as an internal action; makeFunctionReference only types public references.
    const t = receiver("bridge-secret", callback, received);
    const [inboxId] = await t.mutation(components.mail.bootstrap.ensureInboxes, {
      domain: "example.com",
      inboxes: [{ localPart: "mail", label: "Mail" }],
    });
    const ingressKey = "c".repeat(64);
    const begin = await t.fetch("/api/mail/ingress/begin", {
      method: "POST",
      headers: { authorization: "Bearer bridge-secret" },
      body: JSON.stringify({
        version: 1,
        recipient: "mail@example.com",
        ingressKey,
        envelopeFrom: "sender@example.com",
        rawSize: 12,
        receivedAt: 1,
      }),
    });
    expect(begin.status).toBe(200);
    const request = {
      method: "POST",
      headers: { authorization: "Bearer bridge-secret" },
      body: JSON.stringify({
        version: 1,
        recipient: "mail@example.com",
        ingressKey,
        parse: { kind: "parsed" },
        headerFrom: "sender@example.com",
        replyToAddress: "sender@example.com",
        headerTo: ["mail@example.com"],
        headerCc: [],
        rfcMessageId: "<message@example.com>",
        inReplyTo: null,
        references: [],
        subject: "Hello",
        snippet: "Hello",
        occurredAt: 1,
        bodies: [{ content: "Hello", originalByteCount: 5, truncated: false }],
        attachments: [],
      }),
    };
    expect(await (await t.fetch("/api/mail/ingress/complete", request)).json()).toEqual({
      kind: "committed",
    });
    expect(received).not.toHaveBeenCalled();
    expect(await (await t.fetch("/api/mail/ingress/complete", request)).json()).toEqual({
      kind: "duplicate",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(received).toHaveBeenCalledExactlyOnceWith({
      messageId: expect.any(String),
      inboxId,
      threadId: expect.any(String),
    });
  });
});
