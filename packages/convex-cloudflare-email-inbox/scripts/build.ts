import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = fileURLToPath(new URL("../dist", import.meta.url));
rmSync(outputRoot, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", "tsconfig.json"],
  { cwd: packageRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
