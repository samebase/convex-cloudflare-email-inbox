// The setup around the component, as one Alchemy function: the Worker that
// receives, stores, and serves mail, its bucket, and what that Worker and a
// Convex deployment must share. It sits next to the component to try the
// idea that a component ships its own wiring.
//
// The function uploads the Worker that the package ships
// (dist/worker.bundle.js). The app's own Worker stays untouched. The sending
// credentials the component reads (CLOUDFLARE_EMAIL_API_TOKEN and
// CLOUDFLARE_EMAIL_ACCOUNT_ID) are operator settings and stay in the Convex
// dashboard.
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

export interface EmailInboxProps {
  /**
   * The Convex deployment that runs the component, and a deploy key of it.
   * The deployment name also names the Worker and the bucket, so it is a
   * value or an Output, which the function can map.
   */
  readonly deployment: string | Output.Output<string>;
  readonly deployKey: Alchemy.Input<Redacted.Redacted<string>>;
  /** The .convex.site URL of the deployment. The Worker posts inbound mail there. */
  readonly convexSiteUrl: Alchemy.Input<string>;
  /** The zone that receives the mail, by name or id. Its catch-all rule sends every message to the Worker. */
  readonly zone: string;
}

/**
 * The name of the Worker and of its bucket. One Convex deployment has one
 * inbox, so the name is unique per app and readable in the dashboard. 54
 * characters is the limit Alchemy sets on the Worker names it makes.
 */
export const inboxName = (deployment: string) => `mail-${deployment.toLowerCase()}`.slice(0, 54);

/**
 * Whether a destroy keeps the Worker and the bucket: yes, unless
 * DESTROY_APP is set, the switch of the app stacks. Alchemy reads a removal
 * policy from the state that the last deploy wrote.
 */
const keep = Effect.gen(function* () {
  return !(yield* Config.Boolean("DESTROY_APP").pipe(Config.withDefault(false)));
}).pipe(Effect.orDie);

/**
 * One inbox: the Worker with its bucket as MAIL_STORAGE, the secret and the
 * URL that let the Worker and Convex trust each other, and the catch-all
 * rule of the zone. The resources go under `id` in the stack state.
 *
 * The catch-all rule is retained on destroy: a destroy removes it from state
 * and leaves the routing in place.
 */
export const EmailInbox = (id: string, props: EmailInboxProps) =>
  Namespace.push(
    id,
    Effect.gen(function* () {
      // Alchemy makes the secret once and keeps it in state.
      const bridgeSecret = yield* Alchemy.Random("BridgeSecret");
      const name = Output.asOutput(props.deployment).pipe(Output.map(inboxName));
      const bucket = yield* Cloudflare.R2.Bucket("Storage", { name }).pipe(
        Alchemy.RemovalPolicy.retain(keep),
      );
      const worker = yield* Cloudflare.Worker("Worker", {
        name,
        main: new URL("./worker.bundle.js", import.meta.url).href,
        // The bundle holds every dependency. Upload it alone, byte for byte.
        bundle: false,
        rules: [],
        compatibility: { date: "2026-05-14" },
        env: {
          CONVEX_SITE_URL: props.convexSiteUrl,
          MAIL_BRIDGE_SECRET: bridgeSecret.text,
          MAIL_STORAGE: bucket,
        },
      }).pipe(Alchemy.RemovalPolicy.retain(keep));
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

      // Email Routing itself stays enabled from the dashboard: Alchemy's
      // Routing resource calls the enable endpoint on every create, and
      // Cloudflare does not document that call on a zone that is already
      // enabled.
      yield* Cloudflare.Email.CatchAll("CatchAll", {
        zone: props.zone,
        name: Output.interpolate`${worker.workerName} catch-all`,
        enabled: true,
        actions: [{ type: "worker", value: [worker.workerName] }],
      }).pipe(Alchemy.RemovalPolicy.retain());

      return { bucketName: bucket.bucketName, workerUrl: worker.url };
    }),
  );
