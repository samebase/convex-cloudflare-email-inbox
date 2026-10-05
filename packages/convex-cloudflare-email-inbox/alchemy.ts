// The setup around the component, as one Alchemy function: what a Worker
// and a Convex deployment need so that the component receives, stores, and
// serves mail. It sits next to the component to try the idea that a
// component ships its own wiring. The published package leaves it out:
// "files" in package.json does not list it.
//
// The function declares only values that two sides must share and that
// nobody edits by hand: the bridge secret, the Worker URL, and the catch-all
// rule. The storage buckets are bindings of the Worker, named in its
// cloudflare.config.ts. The sending credentials the component reads
// (CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_EMAIL_ACCOUNT_ID) are operator
// settings and stay in the Convex dashboard.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

export interface EmailInboxProps {
  /**
   * The Worker that runs the handler from "./worker". It gets the secret
   * MAIL_BRIDGE_SECRET. Its cloudflare.config.ts binds the storage bucket
   * and the preview bucket as MAIL_STORAGE.
   */
  readonly worker: WorkersBuilds.Worker;
  /** The Convex deployment that runs the component, and a deploy key of it. */
  readonly deployment: Alchemy.Input<string>;
  readonly deployKey: Alchemy.Input<Redacted.Redacted<string>>;
  /** The zone that receives the mail, by name or id. Its catch-all rule sends every message to the Worker. */
  readonly zone: string;
}

/**
 * The setup of one inbox: the routing on Cloudflare, and the secret and the
 * URL that let the Worker and Convex trust each other. The resources go
 * under `id` in the stack state.
 *
 * The catch-all rule is retained on destroy: a destroy removes it from state
 * and leaves the routing in place.
 */
export const EmailInbox = (id: string, props: EmailInboxProps) =>
  Namespace.push(
    id,
    Effect.gen(function* () {
      const workerName = props.worker.name;

      // Alchemy makes the secret once and keeps it in state.
      const bridgeSecret = yield* Alchemy.Random("BridgeSecret");
      yield* WorkersBuilds.Secret("WorkerBridgeSecret", {
        worker: workerName,
        name: "MAIL_BRIDGE_SECRET",
        value: bridgeSecret.text,
      });
      yield* Convex.EnvironmentVariable("ConvexBridgeSecret", {
        deployment: props.deployment,
        deployKey: props.deployKey,
        name: "MAIL_BRIDGE_SECRET",
        value: bridgeSecret.text,
      });

      // Convex calls the Worker at this URL to serve stored objects. The URL
      // is undefined when the account has no workers.dev subdomain yet.
      const workerUrl = props.worker.url.pipe(
        Output.mapEffect((url) =>
          url === undefined
            ? Effect.die(new Error("Set the workers.dev subdomain of the Cloudflare account."))
            : Effect.succeed(url),
        ),
      );
      yield* Convex.EnvironmentVariable("ConvexWorkerUrl", {
        deployment: props.deployment,
        deployKey: props.deployKey,
        name: "MAIL_WORKER_URL",
        value: workerUrl,
      });

      // The first install declared the catch-all at the root of the stack.
      // The former id moves its state row here. Remove the renamedFrom call
      // after one deploy.
      //
      // Email Routing itself stays enabled from the dashboard: Alchemy's
      // Routing resource calls the enable endpoint on every create, and
      // Cloudflare does not document that call on a zone that is already
      // enabled.
      yield* Cloudflare.Email.CatchAll("CatchAll", {
        zone: props.zone,
        name: Output.interpolate`${workerName} catch-all`,
        enabled: true,
        actions: [{ type: "worker", value: [workerName] }],
      }).pipe(Alchemy.RemovalPolicy.retain(), Alchemy.renamedFrom({ fqn: "CatchAll" }));
    }),
  );
