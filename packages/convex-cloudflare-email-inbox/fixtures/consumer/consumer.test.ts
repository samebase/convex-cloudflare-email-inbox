/// <reference types="vite/client" />
import { defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import { components } from "./_generated/api";
import mailConfig from "@samebase/convex-cloudflare-email-inbox/convex.config.js";
import { register } from "@samebase/convex-cloudflare-email-inbox/test";
import { normalizeMailAddress } from "@samebase/convex-cloudflare-email-inbox/protocol";

const modules = import.meta.glob(["./_generated/*.ts"]);
const component = components.mail;

it("installs the packed exports and retains one send with an unpatched consumer", async () => {
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
    clientRequestId: "packed-consumer-send-request",
    to: ["recipient@example.net"],
    subject: "Packed email",
    text: "From the published package exports.",
  };
  try {
    const first = await t.action(async (ctx) => email.send(ctx, request));
    expect(first.kind).toBe("accepted");
    expect(first.messageId).toBeTruthy();
    const delivery = await t.query(component.delivery.get, { messageId: first.messageId });
    const { messageId, ...outcome } = first;
    expect(delivery).toEqual(outcome);
    expect(await t.action(async (ctx) => email.send(ctx, request))).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    const threads = await t.query(component.mail.listThreads, {
      inboxId: null,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(threads.page).toHaveLength(1);
    const messages = await t.query(component.mail.listMessages, {
      threadId: threads.page[0]._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(messages.page[0]).toMatchObject({
      _id: messageId,
      status: "accepted",
      bodyText: request.text,
    });
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
