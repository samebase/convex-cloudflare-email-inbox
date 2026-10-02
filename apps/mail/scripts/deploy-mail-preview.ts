import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const backendUrlFile = new URL("../.wrangler/mail-preview-backend-url", import.meta.url);
const run = promisify(execFile);

if (process.argv[2] === "--prepare") {
  if (process.env["WORKERS_CI_BRANCH"] && process.env["WORKERS_CI_BRANCH"] !== "main") {
    const siteUrl = process.env["VITE_CONVEX_SITE_URL"];
    if (!siteUrl) throw new Error("Convex must supply VITE_CONVEX_SITE_URL for the preview build.");
    await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true });
    await writeFile(backendUrlFile, siteUrl);
  }
} else {
  // Convex supplies this URL during the build. The Worker bridge must use the same preview backend.
  const siteUrl = (await readFile(backendUrlFile, "utf8")).trim();
  const wranglerEntrypoint = fileURLToPath(
    new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")),
  );
  const { stdout } = await run(process.execPath, [
    wranglerEntrypoint,
    "preview",
    "--json",
    "--var",
    `CONVEX_SITE_URL:${siteUrl}`,
    ...process.argv.slice(2),
  ]);
  const { preview } = z
    .object({
      preview: z.object({ name: z.string(), urls: z.array(z.url()).nonempty() }),
    })
    // Wrangler 4.136.2 prints asset upload progress before its JSON result.
    .parse(JSON.parse(stdout.slice(stdout.indexOf('{\n  "preview":'))));
  const convexEntrypoint = fileURLToPath(
    new URL("../node_modules/convex/bin/main.js", import.meta.url),
  );
  for (const name of ["MAIL_WORKER_URL", "SITE_URL"]) {
    await run(process.execPath, [
      convexEntrypoint,
      "env",
      "set",
      "--preview-name",
      preview.name,
      name,
      preview.urls[0],
    ]);
  }
  console.log(`Mail preview deployed: ${preview.urls[0]}`);
}
