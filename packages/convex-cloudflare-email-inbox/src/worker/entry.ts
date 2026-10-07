// The inbox Worker as an Alchemy Worker on the Effect runtime. Email events
// go to receiveEmail, and GET /api/mail/object goes to downloadObject.
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { downloadObject, receiveEmail } from "./index.js";

/** The bucket that keeps the raw messages and their attachments. */
export const Storage = Cloudflare.R2.Bucket("Storage");

/** A download names its object with a grant from createObjectGrant: two base64url parts. */
class Objects extends HttpApiGroup.make("Objects").add(
  HttpApiEndpoint.get("download", "/api/mail/object", {
    query: Schema.Struct({ grant: Schema.String.check(Schema.isPattern(/^[\w-]+\.[\w-]+$/)) }),
  }),
) {}

class InboxApi extends HttpApi.make("InboxApi").add(Objects) {}

/**
 * The Worker never serves files or compresses responses, so HttpPlatform is
 * stubbed, as in Alchemy's state-store Worker (effect 4.0.0 also requires
 * `platform` and `compression`).
 */
const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: () => Effect.die("HttpPlatform.fileResponse not supported"),
  fileWebResponse: () => Effect.die("HttpPlatform.fileWebResponse not supported"),
});

/** The values that the stack sets with the Worker's `env`. */
const Settings = Schema.Struct({
  CONVEX_SITE_URL: Schema.String,
  MAIL_BRIDGE_SECRET: Schema.String,
});

/**
 * The program of the inbox Worker. `email` is the email event source:
 * `Cloudflare.email({ zone })` also routes the zone's mail to the Worker,
 * `Cloudflare.email()` leaves the routing to you.
 */
export const inbox = (email: ReturnType<typeof Cloudflare.email>) =>
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Storage);
    // The environment is filled when a handler runs, so the handlers read it.
    // A Worker without the settings is misconfigured: a defect.
    const env = yield* Cloudflare.Workers.WorkerEnvironment;
    const settings = Effect.all({
      settings: Schema.decodeUnknownEffect(Settings)(env),
      MAIL_STORAGE: bucket.raw,
    }).pipe(
      Effect.map(({ settings, MAIL_STORAGE }) => ({ ...settings, MAIL_STORAGE })),
      Effect.orDie,
    );

    yield* email.subscribe((message) =>
      settings.pipe(
        Effect.flatMap((settings) =>
          // @ts-expect-error message.raw and bucket.raw are workerd's own email message and R2 binding,
          // typed by @cloudflare/workers-types; receiveEmail declares them with the DOM library's
          // ReadableStream, whose read result types differ. The runtime objects are the same.
          Effect.tryPromise(() => receiveEmail(message.raw, settings)),
        ),
        Effect.catch(() => message.setReject("Mail storage is temporarily unavailable")),
      ),
    );

    const objects = HttpApiBuilder.group(InboxApi, "Objects", (handlers) =>
      handlers.handle("download", ({ request }) =>
        Effect.gen(function* () {
          const webRequest = yield* HttpServerRequest.toWeb(request);
          const current = yield* settings;
          // @ts-expect-error bucket.raw is workerd's R2 binding, typed by @cloudflare/workers-types;
          // downloadObject declares its get result with the DOM library's ReadableStream, whose
          // read result types differ. The runtime object is the same.
          const response = yield* Effect.promise(() => downloadObject(webRequest, current));
          return HttpServerResponse.fromWeb(response);
        }).pipe(Effect.orDie),
      ),
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        HttpApiBuilder.layer(InboxApi).pipe(
          Layer.provide(objects),
          Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
        ),
      ),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Cloudflare.EmailEventSourceLive, Cloudflare.R2.ReadWriteBucketBinding),
    ),
  );

export default Cloudflare.Worker("Inbox", { main: import.meta.url }, inbox(Cloudflare.email()));
