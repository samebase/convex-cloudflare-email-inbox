import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { register } from "@samebase/convex-cloudflare-email-inbox/test";
import { api, components } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it("denies every monitor query to anonymous and non-owner users", async () => {
  vi.stubEnv("OWNER_EMAIL", "owner@example.test");
  const t = convexTest(schema, modules);
  register(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "visitor@example.test" }));
  for (const viewer of [t, t.withIdentity({ subject: userId })]) {
    await expect(viewer.query(api.emailMonitor.listInboxes, {})).rejects.toThrow();
    await expect(
      viewer.query(api.emailMonitor.listHistory, {
        inboxId: null,
        status: null,
        paginationOpts: { numItems: 25, cursor: null },
      }),
    ).rejects.toThrow();
    await expect(
      viewer.query(api.emailMonitor.getMessage, { messageId: "foreign-message" }),
    ).rejects.toThrow();
    await expect(
      viewer.query(api.emailMonitor.getDelivery, { messageId: "foreign-message" }),
    ).rejects.toThrow();
  }
});

it("lets the owner read message history, content, and delivery without sending", async () => {
  vi.stubEnv("OWNER_EMAIL", "owner@example.test");
  const t = convexTest(schema, modules);
  register(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "owner@example.test" }));
  const inboxId = await t.mutation(components.mail.inboxes.create, {
    domain: "example.test",
    localPart: "notifications",
    label: "Notifications",
  });
  const messageId = await t.mutation(components.mail.mail.queueSend, {
    inboxId,
    clientRequestId: "monitor-test",
    to: ["person@example.net"],
    cc: [],
    subject: "Receipt",
    text: "Saved mail",
  });
  const owner = t.withIdentity({ subject: userId });
  expect(await owner.query(api.emailMonitor.listInboxes, {})).toMatchObject([
    { address: "notifications@example.test" },
  ]);
  const history = await owner.query(api.emailMonitor.listHistory, {
    inboxId,
    status: "queued",
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(history.page).toMatchObject([{ _id: messageId, status: "queued" }]);
  expect(await owner.query(api.emailMonitor.getMessage, { messageId })).toMatchObject({
    bodyText: "Saved mail",
  });
  expect(await owner.query(api.emailMonitor.getDelivery, { messageId })).toMatchObject({
    kind: "queued",
  });
});
