// Deploys the Worker Preview of a Workers build on a branch other than main,
// then gives its URL to the Convex preview deployment of the same branch as
// SITE_URL. Production deploys run `cf deploy --prebuilt` from package.json
// directly.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
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
const result = z.object({
  preview_id: z.string(),
  preview_name: z.string(),
  preview_slug: z.string(),
  preview_urls: z.array(z.url()).nonempty(),
  deployment_id: z.string(),
  deployment_urls: z.array(z.url()),
});
const preview = result.parse(lastJsonObject(stdout));

// Workers Builds reads this file for the preview URL on the pull request;
// cf does not write it yet. The entry is the one `wrangler preview` writes.
const outputFilePath = wranglerOutputFilePath();
if (outputFilePath) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });
  const entry = {
    version: 1,
    type: "preview",
    worker_name: await deployedWorkerName(),
    ...preview,
    timestamp: new Date().toISOString(),
  };
  await appendFile(outputFilePath, `${JSON.stringify(entry)}\n`);
}

const convexEntrypoint = fileURLToPath(
  new URL("../node_modules/convex/bin/main.js", import.meta.url),
);
await run(process.execPath, [
  convexEntrypoint,
  "env",
  "set",
  "--preview-name",
  preview.preview_name,
  "SITE_URL",
  preview.preview_urls[0],
]);
console.log(`Mail preview deployed: ${preview.preview_urls[0]}`);

// cf prints the result as a JSON object. Progress lines may come before it,
// so parse from the last line that opens an object.
function lastJsonObject(output: string): unknown {
  const start = output.lastIndexOf("\n{");
  return JSON.parse(output.slice(start === -1 ? output.indexOf("{") : start + 1));
}

// The name of the Worker that `cf previews deploy --prebuilt` uploaded, from
// the Build Output.
async function deployedWorkerName() {
  const file = new URL(
    "../.cloudflare/output/v0/workers/default/worker.config.json",
    import.meta.url,
  );
  return z.object({ name: z.string() }).parse(JSON.parse(await readFile(file, "utf8"))).name;
}

// Wrangler's output-file protocol (packages/workers-utils/src/output.ts in
// cloudflare/workers-sdk): one JSON object per line in the file that
// WRANGLER_OUTPUT_FILE_PATH names, or in a new file in the directory that
// WRANGLER_OUTPUT_FILE_DIRECTORY names. Neither variable set: no file.
function wranglerOutputFilePath() {
  const filePath = process.env["WRANGLER_OUTPUT_FILE_PATH"];
  if (filePath) return filePath;
  const directory = process.env["WRANGLER_OUTPUT_FILE_DIRECTORY"];
  if (!directory) return undefined;
  const date = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(".", "_")
    .replace("T", "_")
    .replace("Z", "");
  return path.resolve(directory, `wrangler-output-${date}-${randomBytes(3).toString("hex")}.json`);
}
