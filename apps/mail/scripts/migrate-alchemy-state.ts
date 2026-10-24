import { appendFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemist from "alchemy/Alchemist";
import { encodeState, State, type StateService } from "alchemy/State";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { z } from "zod";

const sourceAddress = { stack: "SamebaseMail", stage: "prod" };
const targetAddress = {
  stack: "samebase/convex-cloudflare-email-inbox/apps/mail",
  stage: "prod",
};
const repository = "samebase/convex-cloudflare-email-inbox";
const completedCutover = z.object({
  "samebase.run": z.object({
    version: z.literal(1),
    repository: z.literal(repository),
    stackFile: z.literal("apps/mail/alchemy.run.ts"),
    branch: z.literal("main"),
    pullRequest: z.null(),
    source: z.literal("github-actions"),
  }),
});
const mailOutput = z.strictObject({
  url: z.url(),
  inbox: z.strictObject({ workerUrl: z.url() }),
});

const equal = (left: unknown, right: unknown) =>
  isDeepStrictEqual(encodeState(left), encodeState(right));

function applicationOutput(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Mail state must have an object output.");
  }
  return mailOutput.parse(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "samebase.run")),
  );
}

/** Copy only this production stack. Existing matching rows allow recovery after an interrupted copy. */
export const copyMailState = (
  source: StateService,
  target: StateService,
  mode: "check" | "copy" | "verify",
) =>
  Effect.gen(function* () {
    const fqns = [...(yield* source.list(sourceAddress))].sort();
    if (fqns.length === 0) throw new Error("The source Mail stack is empty.");
    const records = yield* Effect.forEach(fqns, (fqn) =>
      Effect.gen(function* () {
        const value = yield* source.get({ ...sourceAddress, fqn });
        if (
          !value ||
          value.kind === "action" ||
          (value.status !== "created" && value.status !== "updated") ||
          value.fqn !== fqn
        ) {
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
      if (mode === "verify" && existing === undefined) {
        throw new Error(`Destination resource ${fqn} has not been copied.`);
      }
      if (existing !== undefined && !equal(existing, value)) {
        throw new Error(
          `Destination resource ${fqn} differs from the source. No overwrite is allowed.`,
        );
      }
    }
    const existingOutput = yield* target.getOutput(targetAddress);
    if (mode === "verify" && existingOutput === undefined) {
      throw new Error("The destination has no completed copy. Run the migration first.");
    }
    if (existingOutput !== undefined && !equal(applicationOutput(existingOutput), output)) {
      throw new Error("The destination output differs from the source. No overwrite is allowed.");
    }
    if (mode !== "copy") return { resources: records.length, copied: false };

    for (const { fqn, value } of records) {
      yield* target.set({ ...targetAddress, fqn, value });
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
    // Publish the output only after every copied record and the source snapshot pass verification.
    const writtenOutput = yield* target.setOutput({ ...targetAddress, value: output });
    if (!equal(yield* target.getOutput(targetAddress), writtenOutput)) {
      throw new Error("The destination output failed verification.");
    }
    return { resources: records.length, copied: true };
  });

export function checkCutoverPlan(
  plan: Pick<Alchemist.Stack.PlanSnapshot, "summary" | "resources" | "actions">,
) {
  const { create, replace, delete: deleted, orphaned, adopted } = plan.summary;
  if (create + replace + deleted + orphaned + adopted !== 0) {
    throw new Error("Cutover must not create, replace, delete, orphan, or adopt resources.");
  }
  for (const resource of plan.resources) {
    if (
      resource.action === "update" &&
      resource.fqn !== "Mail/Inbox" &&
      resource.fqn !== "Mail/SendingToken"
    ) {
      throw new Error(`Unexpected cutover update: ${resource.fqn}. Review it before deployment.`);
    }
  }
  if (plan.actions.some((action) => action.action !== "noop")) {
    throw new Error("Cutover must not run or delete stack actions.");
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply" && args[0] !== "--cutover")) {
    throw new Error("Usage: node scripts/migrate-alchemy-state.ts [--apply|--cutover]");
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* Convex.runRecord({ cwd: process.cwd(), env: process.env });
      const cutover = args[0] === "--cutover";
      if (run.repository !== repository || run.stackFile !== "apps/mail/alchemy.run.ts") {
        throw new Error("Run this migration from apps/mail in the Mail repository.");
      }
      if (cutover && (run.source !== "github-actions" || run.branch !== "main")) {
        throw new Error("Cutover must run in the main GitHub Actions deployment.");
      }
      if (args[0] === "--apply" && run.branch === "main") {
        throw new Error("Copy from a migration branch. Only a successful deploy may record main.");
      }
      // The Convex store's temporary access key stays valid until verification finishes.
      const target = yield* Context.get(yield* Layer.build(Convex.state({ team: 38516 })), State);
      if (cutover && completedCutover.safeParse(yield* target.getOutput(targetAddress)).success) {
        console.log("Mail already completed the cutover. Continue with the normal deployment.");
        return;
      }
      const source = yield* Alchemist.State.store({ backend: "cloudflare" });
      const result = yield* copyMailState(
        source,
        target,
        cutover ? "verify" : args[0] === "--apply" ? "copy" : "check",
      );
      console.log(
        `${result.copied ? "Copied and verified" : "Checked"} ${result.resources} Mail resources. No source state or cloud resources were deleted.`,
      );
      if (args.length === 0) return;

      const stack = { entrypoint: "alchemy.run.ts", stage: "prod" };
      const drift = yield* Alchemist.Drift.inspect(stack);
      if (Alchemist.Drift.hasDrift(drift)) {
        throw new Error(
          `Mail has infrastructure drift: ${drift.resources
            .filter((resource) => resource.status !== "in-sync")
            .map((resource) => `${resource.fqn} (${resource.status})`)
            .join(", ")}. Review it before cutover; no repair was run.`,
        );
      }
      const plan = yield* Alchemist.Stack.plan({
        target: stack,
        operation: "deploy",
        adopt: false,
        updateStateStore: false,
      });
      checkCutoverPlan(plan);
      console.log("Verified cutover plan:", plan.summary);
      if (cutover) {
        const githubOutput = process.env["GITHUB_OUTPUT"];
        if (!githubOutput) throw new Error("GITHUB_OUTPUT is required for the cutover workflow.");
        // Apply this checked snapshot without a second plan or automatic drift repair.
        yield* Alchemist.Stack.apply(plan);
        if (!completedCutover.safeParse(yield* target.getOutput(targetAddress)).success) {
          throw new Error("The completed deployment output failed verification.");
        }
        yield* Effect.promise(() => appendFile(githubOutput, "applied=true\n"));
        console.log("Mail cutover completed. The Cloudflare source state remains available.");
      }
    }).pipe(Effect.provide(Alchemist.layer()), Effect.scoped),
  );
}
