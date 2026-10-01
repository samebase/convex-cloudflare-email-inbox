/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/*.js",
  "!./**/*.test.ts",
  "!./**/*.convex.test.ts",
]);

describe("component history pagination", () => {
  it("lists global and inbox threads and preserves message page split metadata", async () => {
    const t = convexTest(schema, modules);
    const inboxIds = await t.mutation(api.bootstrap.ensureInboxes, {
      domain: "example.com",
      inboxes: [{ localPart: "notifications", label: "Notifications" }],
    });
    const inboxId = inboxIds[0];
    const firstId = await t.mutation(api.mail.queueSend, {
      inboxId,
      threadId: null,
      clientRequestId: "pagination-first-message",
      to: ["recipient@example.com"],
      cc: [],
      subject: "History",
      text: "First message",
      inReplyTo: null,
      references: [],
    });
    const first = await t.run(async (ctx) => await ctx.db.get(firstId));
    if (!first) throw new Error("Missing fixture message");
    await t.mutation(api.mail.queueSend, {
      inboxId,
      threadId: first.threadId,
      clientRequestId: "pagination-second-message",
      to: ["recipient@example.com"],
      cc: [],
      subject: "History",
      text: "Second message",
      inReplyTo: null,
      references: [],
    });

    const globalThreads = await t.query(api.mail.listThreads, {
      inboxId: null,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const inboxThreads = await t.query(api.mail.listThreads, {
      inboxId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const messages = await t.query(api.mail.listMessages, {
      threadId: first.threadId,
      paginationOpts: { numItems: 10, cursor: null, maximumRowsRead: 1 },
    });

    expect(globalThreads).toEqual(inboxThreads);
    expect(globalThreads).toMatchObject({ isDone: true, page: [{ messageCount: 2 }] });
    expect(globalThreads).not.toHaveProperty("pageStatus");
    expect(globalThreads).not.toHaveProperty("splitCursor");
    expect(messages.page).toHaveLength(1);
    expect(messages.pageStatus).toBe("SplitRequired");
    expect(messages.splitCursor).toBeTypeOf("string");
    const nextPage = await t.query(api.mail.listMessages, {
      threadId: first.threadId,
      paginationOpts: { numItems: 10, cursor: messages.continueCursor },
    });
    expect(nextPage.page).toHaveLength(1);
    expect(new Set([messages.page[0]._id, nextPage.page[0]._id]).size).toBe(2);
  });
});

describe("message contract", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const inboxId = await t.mutation(api.inboxes.create, {
      domain: "example.com",
      localPart: "support",
      label: "Support",
    });
    return { t, inboxId };
  }

  it("retains rich content and rejects any changed payload under the same key", async () => {
    const { t, inboxId } = await setup();
    const file = {
      r2Key: "mail/outbound/digest/invoice.pdf",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      byteSize: 23,
      sha256: "a".repeat(64),
    };
    const args = {
      inboxId,
      from: " SUPPORT@example.com ",
      threadId: null,
      clientRequestId: "receipt:42",
      to: ["buyer@example.com"],
      cc: [],
      bcc: ["archive@example.com"],
      replyTo: "help@example.com",
      subject: "Receipt",
      text: "Receipt",
      html: "<p>Receipt</p>",
      attachments: [file],
      inReplyTo: null,
      references: [],
    };
    const messageId = await t.mutation(api.mail.queueSend, args);
    expect(await t.mutation(api.mail.queueSend, args)).toBe(messageId);
    expect(await t.query(api.mail.getMessage, { messageId })).toMatchObject({
      inboxId,
      from: "support@example.com",
      to: args.to,
      bcc: args.bcc,
      replyTo: args.replyTo,
      replyRecipient: args.to[0],
      bodyText: args.text,
      bodyHtml: args.html,
      attachments: [{ filename: file.filename, byteSize: file.byteSize }],
    });
    const variants = [
      { ...args, html: "<p>Changed</p>" },
      { ...args, bcc: ["different@example.com"] },
      { ...args, replyTo: "different@example.com" },
      { ...args, attachments: [{ ...file, sha256: "b".repeat(64) }] },
      { ...args, attachments: [{ ...file, filename: "different.pdf" }] },
      { ...args, attachments: [] },
    ];
    for (const variant of variants) {
      await expect(t.mutation(api.mail.queueSend, variant)).rejects.toThrow("different message");
    }
    expect(await t.run((ctx) => ctx.db.query("emailMessages").take(10))).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("emailAttachments").take(10))).toHaveLength(1);
  });

  it("requires a known matching sender, valid content and stable file identity", async () => {
    const { t, inboxId } = await setup();
    const args = {
      inboxId,
      threadId: null,
      clientRequestId: "validation",
      to: ["person@example.com"],
      cc: [],
      subject: "Hello",
      text: "",
      html: "<p>Hello</p>",
      inReplyTo: null,
      references: [],
    };
    await expect(
      t.mutation(api.mail.queueSend, { ...args, from: "other@example.com" }),
    ).rejects.toThrow("does not match");
    await expect(t.mutation(api.mail.queueSend, { ...args, text: " ", html: " " })).rejects.toThrow(
      "body is required",
    );
    await expect(
      t.mutation(api.mail.queueSend, { ...args, subject: "Hello\r\nBcc: bad@example.com" }),
    ).rejects.toThrow("single line");
    await expect(
      t.mutation(api.mail.queueSend, {
        ...args,
        attachments: [
          {
            r2Key: "file",
            filename: "a.txt",
            contentType: "text/plain",
            byteSize: 1,
            sha256: "invalid",
          },
        ],
      }),
    ).rejects.toThrow("Attachment reference");
    const messageId = await t.mutation(api.mail.queueSend, args);
    expect(await t.query(api.mail.getMessage, { messageId })).toMatchObject({
      bodyText: "Hello",
      bodyHtml: args.html,
    });
  });

  it("derives replies inside the parent inbox, preserves headers and checks parent identity", async () => {
    const { t, inboxId } = await setup();
    const first = await t.mutation(api.mail.queueSend, {
      inboxId,
      threadId: null,
      clientRequestId: "parent",
      to: ["person@example.com"],
      cc: [],
      subject: "Question",
      text: "Hello",
      inReplyTo: null,
      references: [],
    });
    await t.run(async (ctx) =>
      ctx.db.patch(first, {
        rfcMessageId: "<parent@example.com>",
        references: ["<older@example.com>"],
        replyToAddress: "sender-replies@example.com",
      }),
    );
    const replyId = await t.mutation(api.mail.queueReply, {
      messageId: first,
      idempotencyKey: "reply",
      text: "Follow up",
    });
    const parent = await t.query(api.mail.getMessage, { messageId: first });
    const reply = await t.run((ctx) => ctx.db.get(replyId));
    expect(reply).toMatchObject({
      inboxId,
      threadId: parent?.threadId,
      headerTo: ["person@example.com"],
      subject: "Re: Question",
      inReplyTo: "<parent@example.com>",
      references: ["<older@example.com>", "<parent@example.com>"],
      replyToMessageId: first,
    });
    expect(
      await t.mutation(api.mail.queueReply, {
        messageId: first,
        idempotencyKey: "reply",
        text: "Follow up",
      }),
    ).toBe(replyId);
    await expect(
      t.mutation(api.mail.queueReply, {
        messageId: replyId,
        idempotencyKey: "reply",
        text: "Follow up",
      }),
    ).rejects.toThrow("different message");
    if (!reply) throw new Error("Missing reply fixture");
    const thread = await t.query(api.mail.getThread, { threadId: reply.threadId });
    expect(thread?.messageCount).toBe(2);
  });

  it("replays a reply after its parent's provider message ID arrives", async () => {
    const { t, inboxId } = await setup();
    const parentId = await t.mutation(api.mail.queueSend, {
      inboxId,
      threadId: null,
      clientRequestId: "pending-parent",
      to: ["person@example.com"],
      cc: [],
      subject: "Question",
      text: "Hello",
      inReplyTo: null,
      references: [],
    });
    const args = { messageId: parentId, idempotencyKey: "pending-reply", text: "Follow up" };
    const replyId = await t.mutation(api.mail.queueReply, args);
    await t.run((ctx) => ctx.db.patch(parentId, { rfcMessageId: "<late@example.com>" }));
    expect(await t.mutation(api.mail.queueReply, args)).toBe(replyId);
    const reply = await t.run((ctx) => ctx.db.get(replyId));
    expect(reply?.inReplyTo).toBeUndefined();
    await expect(t.mutation(api.mail.queueReply, { ...args, text: "Changed" })).rejects.toThrow(
      "different message",
    );
  });
});
