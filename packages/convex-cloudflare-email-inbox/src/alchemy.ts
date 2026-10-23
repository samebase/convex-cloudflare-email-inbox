import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { inbox } from "./worker/entry.js";

export interface EmailInboxProps {
  /** The .convex.site URL of the deployment. The Worker posts inbound mail there. */
  readonly convexSiteUrl: Alchemy.Input<string>;
  /** The zone that receives the mail, by name or id. Its catch-all rule sends every message to the Worker. */
  readonly zone: string;
  /** The sending domain in this zone, either the zone apex or a subdomain. */
  readonly sendingDomain: string;
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
 * Provision sending, receiving, and storage for the component. The app passes
 * `env` to its Convex deployment and then to its mounted mail component.
 * Resources use native Alchemy handles under `id` in the stack state.
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
        inbox(Cloudflare.email()),
      ).pipe(Alchemy.RemovalPolicy.retain(keep));

      // Keep the IDs used by Cloudflare.email({ zone }) in the deployed stack.
      // The routing resource also resolves a zone name to the ID needed for sending.
      const routing = yield* Namespace.push(
        "Inbox",
        Effect.gen(function* () {
          const routing = yield* Cloudflare.Email.Routing("EmailRouting", {
            zone: props.zone,
            enabled: true,
          }).pipe(Alchemy.RemovalPolicy.retain());
          yield* Cloudflare.Email.CatchAll("EmailCatchAll", {
            zone: routing.zoneId,
            name: "Inbox",
            enabled: true,
            actions: [{ type: "worker", value: [worker.workerName] }],
          }).pipe(Alchemy.RemovalPolicy.retain(keep));
          return routing;
        }),
      );
      // The domain can serve other apps, so removing this inbox must not delete it.
      const sendingDomain = yield* Cloudflare.Email.SendingSubdomain("SendingDomain", {
        zoneId: routing.zoneId,
        name: props.sendingDomain,
      }).pipe(Alchemy.RemovalPolicy.retain());
      const sendingToken = yield* Cloudflare.ApiToken.AccountApiToken("SendingToken", {
        accountId: worker.accountId,
        policies: worker.accountId.pipe(
          Output.map((accountId) => [
            {
              effect: "allow" as const,
              permissionGroups: ["Email Sending Write" as const],
              resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            },
          ]),
        ),
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
      return {
        worker,
        bridgeSecret,
        routing,
        sendingDomain,
        sendingToken,
        env: {
          CLOUDFLARE_EMAIL_API_TOKEN: sendingToken.value,
          CLOUDFLARE_EMAIL_ACCOUNT_ID: sendingToken.accountId,
          MAIL_BRIDGE_SECRET: bridgeSecret.text,
          MAIL_WORKER_URL: workerUrl,
        },
      };
    }),
  );
