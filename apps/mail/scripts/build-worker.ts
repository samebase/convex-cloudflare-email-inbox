// Writes the Build Output of the Worker to .cloudflare/output/v0/, the last
// step of build:app. The deploy commands upload the output as it is:
// `cf deploy --prebuilt` on main, `cf previews deploy --prebuilt` on other
// branches. The latter accepts only a Preview build, so a Workers build on a
// branch other than main writes one. Local builds write a production build
// for deploy:dry-run.
//
// `cf build` cannot write this output: it runs the build command of the
// framework it detects (`vite build` for TanStack Start), and this project
// builds with Vite+ and bundles the Worker with Wrangler. For a project on
// the Wrangler bundler, `cf build` itself runs the Wrangler delegate below,
// and only the delegate takes `--preview`.
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const wranglerDelegate = fileURLToPath(
  new URL("./bin/cf-wrangler.js", import.meta.resolve("wrangler/package.json")),
);
const branch = process.env["WORKERS_CI_BRANCH"];
const preview = branch !== undefined && branch !== "main";

execFileSync(process.execPath, [wranglerDelegate, "build", ...(preview ? ["--preview"] : [])], {
  stdio: "inherit",
});
