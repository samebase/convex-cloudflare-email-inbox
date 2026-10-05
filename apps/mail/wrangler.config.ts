// Build settings of the Wrangler bundler. cf runs Wrangler for this project
// because it declares no @cloudflare/vite-plugin. The Worker settings live in
// cloudflare.config.ts.
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  // `vp build` (TanStack Start) writes the client assets here.
  assetsDirectory: "./dist/client",
});
