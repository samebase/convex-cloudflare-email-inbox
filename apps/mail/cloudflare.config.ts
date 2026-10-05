// The Worker configuration of Mail. scripts/build-worker.ts evaluates this
// file through the Wrangler bundler and writes Build Output to
// .cloudflare/output/v0/. `cf deploy --prebuilt` and
// `cf previews deploy --prebuilt` upload that output without evaluating the
// file again. wrangler.config.ts holds the build settings of the Wrangler
// bundler.
//
// The setup stack (alchemy.run.ts) imports `worker` for its name. Keep
// `worker` a plain object so that import needs no config context.
import process from "node:process";
import { bindings, defineConfig, defineWorker } from "cf/config";

// Workers Builds sets WRANGLER_CI_OVERRIDE_NAME to the name of the connected
// Worker. Wrangler honors the variable; cf 1.0.0-beta.12 does not, so the
// config reads it here. Local commands and the setup stack see no variable
// and get the default. A fork changes the default.
const name = process.env["WRANGLER_CI_OVERRIDE_NAME"] ?? "samebase-mail";

// The Worker bridge must call the Convex deployment of the same build.
// `convex deploy --cmd` sets VITE_CONVEX_SITE_URL only for its command, so
// build:app writes the Worker inside that command and the URL ends up in
// Build Output. A Workers build without the URL fails here instead of
// deploying a Worker that points nowhere. Local evaluations outside the
// Convex deploy (cf workers types, deploy:dry-run, the setup stack) get the
// local Convex site URL.
function convexSiteUrl() {
  const url = process.env["VITE_CONVEX_SITE_URL"];
  if (url) return url;
  if (process.env["WORKERS_CI"]) {
    throw new Error("Write the Worker inside convex deploy --cmd: VITE_CONVEX_SITE_URL is unset.");
  }
  return "http://127.0.0.1:3211";
}

// The values that production and previews share. Previews get their own
// storage bucket below, and no MAIL_RECOVERY_ADDRESS: the preview settings
// of the Worker hold only MAIL_BRIDGE_SECRET, and cf refuses a version
// whose declared secret the Worker does not have.
const env = {
  CONVEX_SITE_URL: bindings.text(convexSiteUrl()),
  MAIL_BRIDGE_SECRET: bindings.secret(),
  ASSETS: bindings.assets(),
};

export const worker = defineWorker({
  name,
  compatibilityDate: "2026-05-14",
  entrypoint: "./worker/index.ts",
  previewUrls: true,
  assets: {
    htmlHandling: "none",
    // Signed downloads must reach the Worker even during browser navigation.
    runWorkerFirst: ["/api/mail/object"],
    // Cloudflare SPA mode serves /index.html for unknown app routes. Keep
    // vite.config.ts emitting the TanStack Start shell there.
    notFoundHandling: "single-page-application",
  },
  env: {
    ...env,
    // The buckets exist and hold mail. A second install in the same account
    // changes both names to <worker> and <worker>-previews.
    MAIL_STORAGE: bindings.r2({ name: "samebase-mail" }),
    MAIL_RECOVERY_ADDRESS: bindings.secret(),
  },
});

export default defineConfig(({ isPreview }) => ({
  worker: isPreview
    ? { ...worker, env: { ...env, MAIL_STORAGE: bindings.r2({ name: "samebase-mail-previews" }) } }
    : worker,
}));
