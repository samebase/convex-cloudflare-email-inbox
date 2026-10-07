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

// The app Worker serves the built app only. Mail goes to the inbox Worker
// that the setup stack uploads from the component.
export const worker = defineWorker({
  name,
  compatibilityDate: "2026-05-14",
  entrypoint: "./worker/index.ts",
  previewUrls: true,
  assets: {
    htmlHandling: "none",
    // Cloudflare SPA mode serves /index.html for unknown app routes. Keep
    // vite.config.ts emitting the TanStack Start shell there.
    notFoundHandling: "single-page-application",
  },
  env: { ASSETS: bindings.assets() },
});

export default defineConfig({ worker });
