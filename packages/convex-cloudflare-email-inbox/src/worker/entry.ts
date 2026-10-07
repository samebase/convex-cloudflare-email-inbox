// The inbox Worker as an Alchemy Worker on the Effect runtime. EmailInbox
// from "../alchemy.ts" declares it with `inbox` and points `main` at this
// file; Alchemy bundles the file when it deploys, and the Worker runs the
// default export below. Email events go to receiveEmail, and
// GET /api/mail/object goes to downloadObject.
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { downloadObject, receiveEmail } from "./index.js";

/**
 * The program of the inbox Worker. `storage` is the bucket that keeps the
 * mail. `routing` is the deploy-time routing of the zone's mail to this
 * Worker, which the deployed Worker ignores.
 */
export const inbox = (
  storage: Cloudflare.R2.Bucket | Effect.Effect<Cloudflare.R2.Bucket, never, Cloudflare.Providers>,
  routing: Cloudflare.EmailSubscribeProps,
) =>
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(storage);
    // The stack sets CONVEX_SITE_URL and MAIL_BRIDGE_SECRET on the Worker.
    // Config reads them from the Worker's environment when a handler runs;
    // a Worker without them is misconfigured, so a missing value is a defect.
    const environment = Effect.gen(function* () {
      return {
        CONVEX_SITE_URL: yield* Config.String("CONVEX_SITE_URL"),
        MAIL_BRIDGE_SECRET: Redacted.value(yield* Config.Redacted("MAIL_BRIDGE_SECRET")),
        MAIL_STORAGE: yield* bucket.raw,
      };
    }).pipe(Effect.orDie);

    yield* Cloudflare.email(routing).subscribe((message) =>
      environment.pipe(
        Effect.flatMap((env) =>
          // @ts-expect-error workerd passes web streams and an R2 binding; only the declarations of
          // @cloudflare/workers-types and the DOM library differ (the stream read result, R2 get overloads).
          Effect.tryPromise(() => receiveEmail(message.raw, env)),
        ),
        Effect.catch(() => message.setReject("Mail storage is temporarily unavailable")),
      ),
    );

    return {
      fetch: Effect.gen(function* () {
        const request = yield* Cloudflare.Request;
        const url = new URL(request.url);
        if (request.method !== "GET" || url.pathname !== "/api/mail/object") {
          return HttpServerResponse.text("Not found", { status: 404 });
        }
        const env = yield* environment;
        return HttpServerResponse.fromWeb(
          // @ts-expect-error workerd passes an R2 binding; only the declarations of
          // @cloudflare/workers-types and the DOM library differ (the R2 get overloads and body stream).
          yield* Effect.promise(() => downloadObject(request, env)),
        );
      }),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Cloudflare.EmailEventSourceLive, Cloudflare.R2.ReadWriteBucketBinding),
    ),
  );

export default Cloudflare.Worker(
  "Worker",
  { main: import.meta.url },
  inbox(Cloudflare.R2.Bucket("Storage"), {}),
);
