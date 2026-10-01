import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const backendUrlFile = new URL("../.wrangler/mail-preview-backend-url", import.meta.url);

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
  const child = spawn(
    process.execPath,
    [
      wranglerEntrypoint,
      "preview",
      "--var",
      `CONVEX_SITE_URL:${siteUrl}`,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  child.on("error", (error) => {
    throw error;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
