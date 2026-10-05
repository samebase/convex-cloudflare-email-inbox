// Workers Builds deploys the Worker with the Convex site URL of the same build.
// `convex deploy --cmd` gives VITE_CONVEX_SITE_URL only to the build command,
// so `--prepare` (the last step of build:app) writes it to a file. The deploy
// command then reads the file:
//   --production  `wrangler deploy` on main
//   no flag       `wrangler preview` on other branches, then the preview URL
//                 goes to the Convex preview deployment
import { execFile, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const siteUrlFile = new URL("../.wrangler/mail-convex-site-url", import.meta.url);
const run = promisify(execFile);
const wranglerEntrypoint = fileURLToPath(
  new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")),
);

if (process.argv[2] === "--prepare") {
  if (process.env["WORKERS_CI_BRANCH"]) {
    const siteUrl = process.env["VITE_CONVEX_SITE_URL"];
    if (!siteUrl) throw new Error("Convex must supply VITE_CONVEX_SITE_URL for the Workers build.");
    await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true });
    await writeFile(siteUrlFile, siteUrl);
  }
} else if (process.argv[2] === "--production") {
  // The Worker bridge must use the backend that this build deployed.
  const siteUrl = (await readFile(siteUrlFile, "utf8")).trim();
  execFileSync(
    process.execPath,
    [wranglerEntrypoint, "deploy", "--var", `CONVEX_SITE_URL:${siteUrl}`, ...process.argv.slice(3)],
    { stdio: "inherit" },
  );
} else {
  // The Worker bridge must use the same preview backend.
  const siteUrl = (await readFile(siteUrlFile, "utf8")).trim();
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
