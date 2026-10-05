// Deploys the Worker Preview of a Workers build on a branch other than main,
// then gives its URL to the Convex preview deployment of the same branch.
// The Worker bridge must use the same preview backend: scripts/build-worker.ts
// already baked the Convex site URL into the Build Output, and Convex needs
// the Worker URL in return. Production deploys run `cf deploy --prebuilt`
// from package.json directly.
import { execFile } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
const cfEntrypoint = fileURLToPath(new URL("./bin/cf", import.meta.resolve("cf/package.json")));

// cf reads the preview name from the Workers Builds branch.
const { stdout } = await run(process.execPath, [
  cfEntrypoint,
  "previews",
  "deploy",
  "--prebuilt",
  ...process.argv.slice(2),
]);
const result = z.object({ preview_name: z.string(), preview_urls: z.array(z.url()).nonempty() });
const { preview_name, preview_urls } = result.parse(lastJsonObject(stdout));

const convexEntrypoint = fileURLToPath(
  new URL("../node_modules/convex/bin/main.js", import.meta.url),
);
for (const name of ["MAIL_WORKER_URL", "SITE_URL"]) {
  await run(process.execPath, [
    convexEntrypoint,
    "env",
    "set",
    "--preview-name",
    preview_name,
    name,
    preview_urls[0],
  ]);
}
console.log(`Mail preview deployed: ${preview_urls[0]}`);

// cf prints the result as a JSON object. Progress lines may come before it,
// so parse from the last line that opens an object.
function lastJsonObject(output: string): unknown {
  const start = output.lastIndexOf("\n{");
  return JSON.parse(output.slice(start === -1 ? output.indexOf("{") : start + 1));
}
