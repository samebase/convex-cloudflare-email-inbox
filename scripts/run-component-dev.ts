import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const appRoot = fileURLToPath(new URL("../apps/mail", import.meta.url));
const componentRoot = fileURLToPath(
  new URL("../packages/convex-cloudflare-email-inbox", import.meta.url),
);
const vitePlusEntrypoint = fileURLToPath(import.meta.resolve("vite-plus/bin"));
const build = spawnSync(process.execPath, [vitePlusEntrypoint, "run", "component:build"], {
  cwd: workspaceRoot,
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const args = process.argv.slice(2);
const mode = args[0];
const runner =
  mode === "--primary"
    ? "run-primary-dev.ts"
    : mode === "--worktree"
      ? "run-worktree-dev.ts"
      : "run-context-dev.ts";
const forwardedArgs = mode === "--primary" || mode === "--worktree" ? args.slice(1) : args;
const watcher = spawn(
  process.execPath,
  [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", "tsconfig.json", "--watch"],
  {
    cwd: componentRoot,
    stdio: "inherit",
  },
);
const app = spawn(process.execPath, [`./scripts/${runner}`, ...forwardedArgs], {
  cwd: appRoot,
  stdio: "inherit",
});
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  watcher.kill();
  app.kill();
  process.exitCode = code;
}
for (const child of [watcher, app]) {
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => stop(code ?? 1));
}
process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));
