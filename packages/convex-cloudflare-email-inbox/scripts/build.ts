import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = fileURLToPath(new URL("../dist", import.meta.url));
rmSync(outputRoot, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", "tsconfig.json"],
  { cwd: packageRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// The Worker that EmailInbox from "./alchemy" uploads: one ES module with
// every dependency inside, which Alchemy uploads byte for byte.
await build({
  entryPoints: [fileURLToPath(new URL("../src/worker/entry.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/worker.bundle.js", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["workerd", "worker"],
  logLevel: "warning",
});
