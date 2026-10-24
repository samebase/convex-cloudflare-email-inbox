import { InMemoryService, type CreatedResourceState } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import { copyMailState } from "./migrate-alchemy-state.ts";

const address = { stack: "samebase/convex-cloudflare-email-inbox/apps/mail", stage: "prod" };
const sourceAddress = { stack: "SamebaseMail", stage: "prod" };
const resource: CreatedResourceState = {
  status: "created",
  resourceType: "Alchemy.Random",
  fqn: "Mail/BridgeSecret",
  logicalId: "BridgeSecret",
  instanceId: "1234567890abcdef1234567890abcdef",
  providerVersion: 1,
  namespace: undefined,
  downstream: ["Mail/Inbox"],
  bindings: [],
  props: {},
  attr: { text: Redacted.make("migration-test-secret") },
};
const output = {
  url: "https://example.convex.site",
  inbox: { workerUrl: "https://example.workers.dev" },
};
const sourceStore = () =>
  InMemoryService(
    { SamebaseMail: { prod: { [resource.fqn]: resource } } },
    { SamebaseMail: { prod: output } },
  );

describe("Mail state migration", () => {
  it("copies complete records and output, preserves the source and other stacks, and can run again", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* sourceStore();
        const target = yield* InMemoryService({ Other: { prod: { unrelated: resource } } });
        expect(yield* copyMailState(source, target, false)).toEqual({
          resources: 1,
          copied: false,
        });
        expect(yield* target.list(address)).toEqual([]);
        expect(yield* copyMailState(source, target, true)).toEqual({ resources: 1, copied: true });
        expect(yield* target.get({ ...address, fqn: resource.fqn })).toEqual(resource);
        expect(yield* target.getOutput(address)).toEqual(output);
        expect(yield* source.get({ ...sourceAddress, fqn: resource.fqn })).toEqual(resource);
        expect(yield* target.list({ stack: "Other", stage: "prod" })).toEqual(["unrelated"]);
        yield* target.setOutput({
          ...address,
          value: { ...output, "samebase.run": { repository: "test" } },
        });
        yield* copyMailState(source, target, true);
      }),
    );
  });

  it("refuses a different destination record before writing any source record", async () => {
    const target = await Effect.runPromise(
      InMemoryService({
        [address.stack]: {
          prod: {
            [resource.fqn]: { ...resource, instanceId: "different" },
          },
        },
      }),
    );
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const source = yield* sourceStore();
          yield* copyMailState(source, target, true);
        }),
      ),
    ).rejects.toThrow("No overwrite is allowed");
    expect(await Effect.runPromise(target.getOutput(address))).toBeUndefined();
  });

  it("rejects unfinished source work and does not create destination rows", async () => {
    const target = await Effect.runPromise(InMemoryService());
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const source = yield* InMemoryService(
            {
              SamebaseMail: {
                prod: {
                  [resource.fqn]: { ...resource, status: "deleting" },
                },
              },
            },
            { SamebaseMail: { prod: output } },
          );
          yield* copyMailState(source, target, true);
        }),
      ),
    ).rejects.toThrow("unfinished work");
    expect(await Effect.runPromise(target.list(address))).toEqual([]);
  });

  it("resumes a partial copy and refuses destination resources outside the source", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* sourceStore();
        const target = yield* InMemoryService({
          [address.stack]: { prod: { [resource.fqn]: resource } },
        });
        yield* copyMailState(source, target, true);
        expect(yield* target.getOutput(address)).toEqual(output);
        yield* target.set({ ...address, fqn: "Unexpected", value: resource });
        const result = yield* copyMailState(source, target, true).pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
        expect(yield* target.list(address)).toEqual([resource.fqn, "Unexpected"]);
      }),
    );
  });
});
