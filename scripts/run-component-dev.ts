import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const build = spawnSync(pnpm, ["run", "component:build"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const watcher = spawn(pnpm, ["run", "component:watch"], { stdio: "inherit" });
const app = spawn(process.execPath, ["./scripts/run-context-dev.ts", ...process.argv.slice(2)], {
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
