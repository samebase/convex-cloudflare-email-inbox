// The root tsconfig.node.json type-checks this file, so the expectTypeOf
// lines fail `pnpm run typecheck` when the props stop matching the two modes.
import type * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import type * as Redacted from "effect/Redacted";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { ownedWorkerName, type EmailInboxProps } from "./alchemy.js";

type Shared = {
  deployment: string;
  deployKey: Redacted.Redacted<string>;
};

describe("EmailInbox props", () => {
  it("take an app Worker or the Convex site URL for an owned Worker, with or without a zone", () => {
    expectTypeOf<Shared & { worker: WorkersBuilds.Worker }>().toExtend<EmailInboxProps>();
    expectTypeOf<
      Shared & { worker: WorkersBuilds.Worker; zone: string }
    >().toExtend<EmailInboxProps>();
    expectTypeOf<Shared & { convexSiteUrl: string }>().toExtend<EmailInboxProps>();
    expectTypeOf<
      Shared & { convexSiteUrl: string; zone: string; keep: false }
    >().toExtend<EmailInboxProps>();
    expectTypeOf<Shared>().not.toExtend<EmailInboxProps>();
    expectTypeOf<
      Shared & { worker: WorkersBuilds.Worker; convexSiteUrl: string }
    >().not.toExtend<EmailInboxProps>();
    expectTypeOf<
      Shared & { worker: WorkersBuilds.Worker; keep: true }
    >().not.toExtend<EmailInboxProps>();
  });
});

describe("ownedWorkerName", () => {
  const suffix = "0123456789abcdef";

  it("puts the inbox id before the suffix in the characters a Worker and a bucket allow", () => {
    expect(ownedWorkerName("Mail", suffix)).toBe("mail-0123456789abcdef");
    expect(ownedWorkerName("Support Mail_2", suffix)).toBe("support-mail-2-0123456789abcdef");
    expect(ownedWorkerName("/Mail/", suffix)).toBe("mail-0123456789abcdef");
  });

  it("shortens the inbox id to keep the name within 54 characters", () => {
    const name = ownedWorkerName("Inbox".repeat(20), suffix);
    expect(name).toHaveLength(54);
    expect(name.endsWith(`-${suffix}`)).toBe(true);
  });
});
