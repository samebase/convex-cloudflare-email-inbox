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
