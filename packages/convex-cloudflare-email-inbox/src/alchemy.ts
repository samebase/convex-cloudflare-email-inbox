// The setup around the component, as one Alchemy function: what a Worker
// and a Convex deployment need so that the component receives, stores, and
// serves mail. It sits next to the component to try the idea that a
// component ships its own wiring.
//
// The function declares only values that two sides must share and that
// nobody edits by hand: the bridge secret, the Worker URL, and the catch-all
// rule. With an attached Worker, the storage buckets are bindings of that
// Worker, named in its cloudflare.config.ts. Without one, the function owns
// the Worker and its bucket. The sending credentials the component reads
// (CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_EMAIL_ACCOUNT_ID) are operator
// settings and stay in the Convex dashboard.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

interface SharedProps {
  /** The Convex deployment that runs the component, and a deploy key of it. */
  readonly deployment: Alchemy.Input<string>;
  readonly deployKey: Alchemy.Input<Redacted.Redacted<string>>;
  /**
   * The zone that receives the mail, by name or id. Its catch-all rule sends
   * every message to the Worker. Without a zone, the function creates no
   * routing rule and the app routes mail to the Worker itself.
   */
  readonly zone?: string;
}

/** An app Worker that runs the handler from "./worker". */
export interface AttachedEmailInboxProps extends SharedProps {
  /**
   * The Worker that runs the handler from "./worker". It gets the secret
   * MAIL_BRIDGE_SECRET. Its cloudflare.config.ts binds the storage bucket
   * and the preview bucket as MAIL_STORAGE, and sets CONVEX_SITE_URL.
   */
  readonly worker: WorkersBuilds.Worker;
  readonly convexSiteUrl?: never;
  readonly keep?: never;
}

/** The Worker that the package ships, uploaded and owned by this function. */
export interface OwnedEmailInboxProps extends SharedProps {
  readonly worker?: never;
  /** The .convex.site URL of the deployment. The Worker posts inbound mail there. */
  readonly convexSiteUrl: Alchemy.Input<string>;
  /** Retain the Worker and its bucket when the stack deletes them. Default true. */
  readonly keep?: boolean;
}

export type EmailInboxProps = AttachedEmailInboxProps | OwnedEmailInboxProps;

/**
 * The name of the owned Worker and of its bucket: the inbox id in the
 * characters both names allow, then a suffix that only the stack state
 * knows. Alchemy adopts an existing bucket with the same name, so the name
 * must not be guessable. 54 characters is the limit Alchemy sets on the
 * Worker names it makes.
 */
export const ownedWorkerName = (id: string, suffix: string) => {
  const prefix = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54 - suffix.length - 1);
  return `${prefix}-${suffix}`;
};

/**
 * The setup of one inbox: the routing on Cloudflare, and the secret and the
 * URL that let the Worker and Convex trust each other. The resources go
 * under `id` in the stack state.
 *
 * Without `worker`, the function uploads the Worker that the package ships
 * (dist/worker.bundle.js) with a new R2 bucket as MAIL_STORAGE. `keep`
 * sets the removal policy of both.
 *
 * With `zone`, the function creates the catch-all rule of that zone. The
 * rule is retained on destroy: a destroy removes it from state and leaves
 * the routing in place.
 */
export const EmailInbox = (id: string, props: EmailInboxProps) =>
  Namespace.push(
    id,
    Effect.gen(function* () {
      // Alchemy makes the secret once and keeps it in state.
      const bridgeSecret = yield* Alchemy.Random("BridgeSecret");
      const worker =
        props.worker === undefined
          ? yield* ownedWorker(id, props, bridgeSecret.text)
          : yield* WorkersBuilds.Secret("WorkerBridgeSecret", {
              worker: props.worker.name,
              name: "MAIL_BRIDGE_SECRET",
              value: bridgeSecret.text,
            }).pipe(Effect.as({ name: props.worker.name, url: props.worker.url }));
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
      if (props.zone !== undefined) {
        yield* Cloudflare.Email.CatchAll("CatchAll", {
          zone: props.zone,
          name: Output.interpolate`${worker.name} catch-all`,
          enabled: true,
          actions: [{ type: "worker", value: [worker.name] }],
        }).pipe(Alchemy.RemovalPolicy.retain());
      }
    }),
  );

const ownedWorker = (
  id: string,
  props: OwnedEmailInboxProps,
  bridgeSecret: Output.Output<Redacted.Redacted<string>>,
) =>
  Effect.gen(function* () {
    const keep = props.keep ?? true;
    const suffix = yield* Alchemy.Random("NameSuffix", { bytes: 8 });
    const name = suffix.text.pipe(Output.map((text) => ownedWorkerName(id, Redacted.value(text))));
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
        MAIL_BRIDGE_SECRET: bridgeSecret,
        MAIL_STORAGE: bucket,
      },
    }).pipe(Alchemy.RemovalPolicy.retain(keep));
    return { name: worker.workerName, url: worker.url };
  });
