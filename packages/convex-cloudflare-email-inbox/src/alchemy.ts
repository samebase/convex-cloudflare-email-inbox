// The setup around the component, as one Alchemy function: the Worker that
// receives, stores, and serves mail, its bucket, and what that Worker and a
// Convex deployment must share. It sits next to the component to try the
// idea that a component ships its own wiring.
//
// The Worker is the Alchemy Worker in ./worker/entry.ts, which the package
// ships; Alchemy bundles it when it deploys. The app's own Worker stays
// untouched. The sending credentials the component reads
// (CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_EMAIL_ACCOUNT_ID) are operator
// settings and stay in the Convex dashboard.
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import { inbox } from "./worker/entry.js";

export interface EmailInboxProps {
  /** The Convex deployment that runs the component, and a deploy key of it. */
  readonly deployment: Alchemy.Input<string>;
  readonly deployKey: Alchemy.Input<Redacted.Redacted<string>>;
  /** The .convex.site URL of the deployment. The Worker posts inbound mail there. */
  readonly convexSiteUrl: Alchemy.Input<string>;
  /** The zone that receives the mail, by name or id. Its catch-all rule sends every message to the Worker. */
  readonly zone: string;
}

/**
 * Whether a destroy keeps the Worker and the bucket: yes, unless
 * DESTROY_APP is set, the switch of the app stacks. Alchemy reads a removal
 * policy from the state that the last deploy wrote.
 */
const keep = Effect.gen(function* () {
  return !(yield* Config.Boolean("DESTROY_APP").pipe(Config.withDefault(false)));
}).pipe(Effect.orDie);

/**
 * One inbox: the Worker with its bucket, the secret and the URL that let the
 * Worker and Convex trust each other, and the routing of the zone's mail to
 * the Worker. The resources go under `id` in the stack state.
 *
 * The Worker enables Email Routing on the zone and points the zone's
 * catch-all rule at itself (Cloudflare.email in ./worker/entry.ts).
 */
export const EmailInbox = (id: string, props: EmailInboxProps) =>
  Namespace.push(
    id,
    Effect.gen(function* () {
      // Alchemy makes the secret once and keeps it in state.
      const bridgeSecret = yield* Alchemy.Random("BridgeSecret");
      // The one step the Alchemy docs do not cover: a Worker that a package ships, declared by
      // the consumer's stack. It uses the documented separate-entry form of `main`.
      const worker = yield* Cloudflare.Worker(
        "Inbox",
        {
          main: new URL("./worker/entry.js", import.meta.url).href,
          env: { CONVEX_SITE_URL: props.convexSiteUrl, MAIL_BRIDGE_SECRET: bridgeSecret.text },
        },
        inbox(Cloudflare.email({ zone: props.zone })),
      ).pipe(Alchemy.RemovalPolicy.retain(keep));
      yield* Convex.EnvironmentVariable("ConvexBridgeSecret", {
        deployment: props.deployment,
        deployKey: props.deployKey,
        name: "MAIL_BRIDGE_SECRET",
        value: bridgeSecret.text,
      });

      // Convex calls the Worker at this URL to serve stored objects. The URL
      // is undefined when the account has no workers.dev subdomain yet.
      const workerUrl = worker.url.pipe(
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

      return { workerUrl: worker.url };
    }),
  );
