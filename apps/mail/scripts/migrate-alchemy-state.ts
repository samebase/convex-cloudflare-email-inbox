import { isDeepStrictEqual } from "node:util";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemist from "alchemy/Alchemist";
import { encodeState, State, type StateService } from "alchemy/State";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const sourceAddress = { stack: "SamebaseMail", stage: "prod" };
const targetAddress = {
  stack: "samebase/convex-cloudflare-email-inbox/apps/mail",
  stage: "prod",
};

const equal = (left: unknown, right: unknown) =>
  isDeepStrictEqual(encodeState(left), encodeState(right));

function applicationOutput(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Mail state must have an object output.");
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "samebase.run"));
}

/** Copy only this production stack. Existing matching rows allow recovery after an interrupted copy. */
export const copyMailState = (source: StateService, target: StateService, apply: boolean) =>
  Effect.gen(function* () {
    const fqns = [...(yield* source.list(sourceAddress))].sort();
    if (fqns.length === 0) throw new Error("The source Mail stack is empty.");
    const records = yield* Effect.forEach(fqns, (fqn) =>
      Effect.gen(function* () {
        const value = yield* source.get({ ...sourceAddress, fqn });
        if (!value || value.kind === "action" || value.status !== "created" || value.fqn !== fqn) {
          throw new Error(`Source resource ${fqn} is missing or has unfinished work.`);
        }
        return { fqn, value };
      }),
    );
    const output = applicationOutput(yield* source.getOutput(sourceAddress));
    const targetFqns = yield* target.list(targetAddress);
    if (targetFqns.some((fqn) => !fqns.includes(fqn))) {
      throw new Error("The destination contains resources outside the source Mail stack.");
    }
    // Check every destination record before the first write. Never overwrite a different stack.
    for (const { fqn, value } of records) {
      const existing = yield* target.get({ ...targetAddress, fqn });
      if (existing !== undefined && !equal(existing, value)) {
        throw new Error(
          `Destination resource ${fqn} differs from the source. No overwrite is allowed.`,
        );
      }
    }
    const existingOutput = yield* target.getOutput(targetAddress);
    if (existingOutput !== undefined && !equal(applicationOutput(existingOutput), output)) {
      throw new Error("The destination output differs from the source. No overwrite is allowed.");
    }
    if (!apply) return { resources: records.length, copied: false };

    for (const { fqn, value } of records) {
      yield* target.set({ ...targetAddress, fqn, value });
    }
    // Convex adds the repository/run record needed by Samebase to the application output.
    const writtenOutput = yield* target.setOutput({ ...targetAddress, value: output });
    if (!equal(yield* target.getOutput(targetAddress), writtenOutput)) {
      throw new Error("The destination output failed verification.");
    }
    if (!equal([...(yield* target.list(targetAddress))].sort(), fqns)) {
      throw new Error("The destination resource list failed verification.");
    }
    for (const { fqn, value } of records) {
      if (!equal(yield* target.get({ ...targetAddress, fqn }), value)) {
        throw new Error(`Destination resource ${fqn} failed verification.`);
      }
      if (!equal(yield* source.get({ ...sourceAddress, fqn }), value)) {
        throw new Error(`Source resource ${fqn} changed during the copy.`);
      }
    }
    if (!equal([...(yield* source.list(sourceAddress))].sort(), fqns)) {
      throw new Error("The source resource list changed during the copy.");
    }
    if (!equal(applicationOutput(yield* source.getOutput(sourceAddress)), output)) {
      throw new Error("The source output changed during the copy.");
    }
    return { resources: records.length, copied: true };
  });

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("Usage: node scripts/migrate-alchemy-state.ts [--apply]");
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Alchemist.State.store({ backend: "cloudflare" });
      // Both stores stay inside this scope until copy and verification finish.
      const target = yield* Context.get(yield* Layer.build(Convex.state({ team: 38516 })), State);
      const result = yield* copyMailState(source, target, args[0] === "--apply");
      console.log(
        `${result.copied ? "Copied and verified" : "Checked"} ${result.resources} Mail resources. No source state or cloud resources were deleted.`,
      );
    }).pipe(Effect.provide(Alchemist.layer()), Effect.scoped),
  );
}
