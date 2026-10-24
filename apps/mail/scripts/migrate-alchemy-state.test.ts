import {
  encodeState,
  reviveState,
  InMemoryService,
  type CreatedResourceState,
  type StateService,
} from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import { checkCutoverPlan, copyMailState } from "./migrate-alchemy-state.ts";

function wireCopy<T>(value: T): T {
  const restored: unknown = JSON.parse(JSON.stringify(encodeState(value)), reviveState);
  // @ts-expect-error Native Alchemy state encoding restores the typed fixture after JSON transport.
  return restored;
}

const address = { stack: "samebase/convex-cloudflare-email-inbox/apps/mail", stage: "prod" };
const sourceAddress = { stack: "SamebaseMail", stage: "prod" };
const resource = wireCopy<CreatedResourceState>({
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
});
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
        const memory = yield* InMemoryService({ Other: { prod: { unrelated: resource } } });
        const target: StateService = {
          ...memory,
          set: (request) => memory.set({ ...request, value: wireCopy(request.value) }),
        };
        expect(yield* copyMailState(source, target, "check")).toEqual({
          resources: 1,
          copied: false,
        });
        expect(yield* target.list(address)).toEqual([]);
        expect(yield* copyMailState(source, target, "copy")).toEqual({
          resources: 1,
          copied: true,
        });
        expect(yield* target.get({ ...address, fqn: resource.fqn })).toEqual(resource);
        expect(yield* target.get({ ...address, fqn: resource.fqn })).not.toBe(resource);
        expect(yield* target.getOutput(address)).toEqual(output);
        expect(yield* source.get({ ...sourceAddress, fqn: resource.fqn })).toEqual(resource);
        expect(yield* target.list({ stack: "Other", stage: "prod" })).toEqual(["unrelated"]);
        yield* target.setOutput({
          ...address,
          value: { ...output, "samebase.run": { repository: "test" } },
        });
        yield* copyMailState(source, target, "copy");
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
          yield* copyMailState(source, target, "copy");
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
          yield* copyMailState(source, target, "copy");
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
        yield* copyMailState(source, target, "copy");
        expect(yield* target.getOutput(address)).toEqual(output);
        yield* target.set({ ...address, fqn: "Unexpected", value: resource });
        const result = yield* copyMailState(source, target, "copy").pipe(Effect.exit);
        expect(result._tag).toBe("Failure");
        expect(yield* target.list(address)).toEqual([resource.fqn, "Unexpected"]);
      }),
    );
  });

  it("copies a resource after a successful update", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* sourceStore();
        yield* source.set({
          ...sourceAddress,
          fqn: resource.fqn,
          value: { ...resource, status: "updated" },
        });
        const target = yield* InMemoryService();
        yield* copyMailState(source, target, "copy");
        expect((yield* target.get({ ...address, fqn: resource.fqn }))?.status).toBe("updated");
      }),
    );
  });

  it("does not publish an output if the source changes during the copy", async () => {
    const source = await Effect.runPromise(sourceStore());
    const target = await Effect.runPromise(InMemoryService());
    await expect(
      Effect.runPromise(
        copyMailState(
          source,
          {
            ...target,
            set: (request) =>
              Effect.gen(function* () {
                const written = yield* target.set(request);
                yield* source.set({
                  ...sourceAddress,
                  fqn: resource.fqn,
                  value: { ...resource, instanceId: "changed" },
                });
                return written;
              }),
          },
          "copy",
        ),
      ),
    ).rejects.toThrow("changed during the copy");
    expect(await Effect.runPromise(target.getOutput(address))).toBeUndefined();
  });

  it("requires every record and the completed output before cutover", async () => {
    const source = await Effect.runPromise(sourceStore());
    const target = await Effect.runPromise(InMemoryService());
    await expect(Effect.runPromise(copyMailState(source, target, "verify"))).rejects.toThrow(
      "has not been copied",
    );
    await Effect.runPromise(target.set({ ...address, fqn: resource.fqn, value: resource }));
    await expect(Effect.runPromise(copyMailState(source, target, "verify"))).rejects.toThrow(
      "no completed copy",
    );
    await Effect.runPromise(target.setOutput({ ...address, value: output }));
    await Effect.runPromise(copyMailState(source, target, "verify"));
  });

  it("rejects secret-bearing legacy outputs before copying", async () => {
    const source = await Effect.runPromise(sourceStore());
    await Effect.runPromise(
      source.setOutput({
        ...sourceAddress,
        value: { ...output, token: Redacted.make("test-secret") },
      }),
    );
    const target = await Effect.runPromise(InMemoryService());
    await expect(Effect.runPromise(copyMailState(source, target, "copy"))).rejects.toThrow();
    expect(await Effect.runPromise(target.list(address))).toEqual([]);
  });

  it("rejects destructive plans and unrelated updates before apply", () => {
    const summary = {
      create: 0,
      update: 0,
      replace: 0,
      delete: 0,
      orphaned: 0,
      adopted: 0,
      noop: 1,
    };
    for (const action of ["create", "replace", "delete", "orphaned", "adopted"] as const) {
      expect(() =>
        checkCutoverPlan({ summary: { ...summary, [action]: 1 }, resources: [], actions: [] }),
      ).toThrow("Cutover must not");
    }
    expect(() =>
      checkCutoverPlan({
        summary: { ...summary, update: 1 },
        resources: [
          {
            fqn: "Mail/Storage",
            logicalId: "Storage",
            resourceType: "Cloudflare.R2Bucket",
            action: "update",
            bindings: [],
          },
        ],
        actions: [],
      }),
    ).toThrow("Unexpected cutover update");
    expect(() =>
      checkCutoverPlan({
        summary: { ...summary, update: 1 },
        resources: [
          {
            fqn: "Mail/Inbox",
            logicalId: "Inbox",
            resourceType: "Cloudflare.Worker",
            action: "update",
            bindings: [],
          },
        ],
        actions: [],
      }),
    ).not.toThrow();
  });
});
