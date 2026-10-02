/// <reference types="vite/client" />
import { defineSchema, httpRouter } from "convex/server";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import { components } from "./_generated/api";
import mailConfig from "@samebase/convex-cloudflare-email-inbox/convex.config.js";
import { register } from "@samebase/convex-cloudflare-email-inbox/test";
import { normalizeMailAddress } from "@samebase/convex-cloudflare-email-inbox/protocol";
import { registerIngressRoutes } from "@samebase/convex-cloudflare-email-inbox/receiving";
import { storeAttachment } from "@samebase/convex-cloudflare-email-inbox/r2";
import { downloadObject, receiveEmail } from "@samebase/convex-cloudflare-email-inbox/worker";

const modules = import.meta.glob(["./_generated/*.ts"]);
const component = components.mail;

it("installs packed exports and deduplicates direct and queued sends in an unpatched consumer", async () => {
  vi.useFakeTimers();
  expect(mailConfig).toBeDefined();
  expect(normalizeMailAddress(" MAIL@Example.com ")).toBe("mail@example.com");
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "test-token");
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "test-account");
  const fetch = vi.fn(async () =>
    Response.json({
      success: true,
      result: {
        message_id: "<test@example.com>",
        delivered: ["recipient@example.net"],
        queued: [],
        permanent_bounces: [],
        suppressed_recipients: [],
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(defineSchema({}), modules);
  register(t);
  const email = new EmailInbox(component, {
    defaultInbox: { address: "mail@example.com", label: "Mail", senderName: "Example" },
  });
  const request = {
    idempotencyKey: "packed-consumer-send-request",
    to: ["recipient@example.net"],
    subject: "Packed email",
    text: "From the published package exports.",
  };
  try {
    const first = await t.action(async (ctx) => email.send(ctx, request));
    expect(first.kind).toBe("accepted");
    expect(first.messageId).toBeTruthy();
    const delivery = await t.query(async (ctx) =>
      email.getDelivery(ctx, { messageId: first.messageId }),
    );
    const { messageId, ...outcome } = first;
    expect(delivery).toEqual(outcome);
    expect(await t.action(async (ctx) => email.send(ctx, request))).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    const threads = await t.query(async (ctx) =>
      email.listThreads(ctx, {
        inboxId: null,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
    expect(threads.page).toHaveLength(1);
    const messages = await t.query(async (ctx) =>
      email.listMessages(ctx, {
        threadId: threads.page[0]._id,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
    expect(messages.page[0]).toMatchObject({
      _id: messageId,
      status: "accepted",
      bodyText: request.text,
    });
    const queuedRequest = { ...request, idempotencyKey: "packed-consumer-enqueue-request" };
    const queuedId = await t.mutation((ctx) => email.enqueue(ctx, queuedRequest));
    expect(await t.mutation((ctx) => email.enqueue(ctx, queuedRequest))).toBe(queuedId);
    expect(await t.query((ctx) => email.getDelivery(ctx, { messageId: queuedId }))).toMatchObject({
      kind: "queued",
    });
    fetch.mockImplementation(async () =>
      Response.json({
        success: true,
        result: { delivered: ["recipient@example.net"], queued: [], permanent_bounces: [] },
      }),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const queuedDelivery = await t.query((ctx) => email.getDelivery(ctx, { messageId: queuedId }));
    expect(queuedDelivery).toMatchObject({ kind: "accepted" });
    expect(queuedDelivery).not.toHaveProperty("providerMessageId");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await t.query((ctx) => email.getMessage(ctx, { messageId: queuedId }))).toMatchObject({
      status: "accepted",
      rfcMessageId: null,
    });
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

it("receives MIME mail, queries it, and replies with an R2 attachment through packed exports", async () => {
  vi.useFakeTimers();
  const secret = "packed-test-bridge-secret";
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "test-token");
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "test-account");
  vi.stubEnv("MAIL_WORKER_URL", "https://worker.example.com");
  vi.stubEnv("MAIL_BRIDGE_SECRET", secret);
  const http = httpRouter();
  registerIngressRoutes(http, component, { secret: () => secret });
  const t = convexTest(defineSchema({}), {
    ...modules,
    "./http.ts": async () => ({ default: http }),
  });
  register(t);
  const email = new EmailInbox(component);
  const objects = new Map<string, ArrayBuffer>();
  const bucket = {
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      objects.set(key, new Uint8Array(value).buffer);
    },
    get: async (key: string) => {
      const content = objects.get(key);
      if (!content) return null;
      const body = new Response(content).body;
      if (!body) throw new Error("Missing fixture body");
      return { body };
    },
  };
  const provider = vi.fn(async (request: Request) => {
    const body = await request.json();
    expect(body).toMatchObject({
      from: "support@example.com",
      recipients: ["reply@example.net", "archive@example.com"],
    });
    expect(request.url).toContain("/email/sending/send_raw");
    expect(body.mime_message).toContain("In-Reply-To: <question@example.net>");
    expect(body.mime_message).toContain("References: <question@example.net>");
    expect(body.mime_message).toContain("filename*0*=UTF-8''answer.txt");
    expect(body.mime_message).toContain("QW5zd2Vy");
    expect(body.mime_message).not.toContain("archive@example.com");
    return Response.json({
      success: true,
      result: {
        message_id: "<answer@example.com>",
        delivered: ["reply@example.net"],
        queued: [],
        permanent_bounces: [],
        suppressed_recipients: [],
      },
    });
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.host === "convex.example.com") {
      return await t.fetch(url.pathname, {
        method: request.method,
        headers: request.headers,
        body: await request.text(),
      });
    }
    if (url.host === "worker.example.com") {
      return await downloadObject(request, { MAIL_BRIDGE_SECRET: secret, MAIL_STORAGE: bucket });
    }
    if (url.host === "api.cloudflare.com") return await provider(request);
    throw new Error("Unexpected fixture URL");
  });
  try {
    const inboxId = await t.mutation((ctx) =>
      email.createInbox(ctx, { address: "support@example.com", label: "Support" }),
    );
    const raw = `From: Sender <sender@example.net>\r
To: support@example.com\r
Reply-To: reply@example.net\r
Message-ID: <question@example.net>\r
Subject: Question\r
Content-Type: text/plain; charset=utf-8\r
\r
Hello\r
`;
    const receive = async () => {
      const bytes = new TextEncoder().encode(raw);
      await receiveEmail(
        {
          from: "sender@example.net",
          to: "support@example.com",
          rawSize: bytes.byteLength,
          raw: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          setReject: (reason) => {
            throw new Error(reason);
          },
        },
        {
          CONVEX_SITE_URL: "https://convex.example.com",
          MAIL_BRIDGE_SECRET: secret,
          MAIL_STORAGE: bucket,
        },
      );
    };
    await receive();
    await receive();
    const threads = await t.query((ctx) =>
      email.listThreads(ctx, { inboxId, paginationOpts: { cursor: null, numItems: 10 } }),
    );
    expect(threads.page).toHaveLength(1);
    expect(threads.page[0]).toMatchObject({ messageCount: 1, unreadCount: 1 });
    expect(objects.size).toBe(1);
    const messages = await t.query((ctx) =>
      email.listMessages(ctx, {
        threadId: threads.page[0]._id,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    const parent = await t.query((ctx) =>
      email.getMessage(ctx, { messageId: messages.page[0]._id }),
    );
    expect(parent).toMatchObject({
      bodyText: "Hello\n",
      replyTo: "reply@example.net",
      rawAvailable: true,
    });
    const file = await storeAttachment(bucket, {
      filename: "answer.txt",
      contentType: "text/plain",
      content: new TextEncoder().encode("Answer").buffer,
    });
    const replyId = await t.mutation((ctx) =>
      email.reply(ctx, {
        messageId: messages.page[0]._id,
        idempotencyKey: "reply:1",
        text: "Answer",
        html: "<p>Answer</p>",
        bcc: ["archive@example.com"],
        attachments: [file],
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query((ctx) => email.getDelivery(ctx, { messageId: replyId }))).toMatchObject({
      kind: "accepted",
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await t.query((ctx) => email.getThread(ctx, { threadId: threads.page[0]._id })),
    ).toMatchObject({ messageCount: 2 });
    await t.mutation((ctx) => email.markThreadRead(ctx, { threadId: threads.page[0]._id }));
    expect(await t.query((ctx) => email.listInboxes(ctx))).toMatchObject([{ unreadCount: 0 }]);
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
