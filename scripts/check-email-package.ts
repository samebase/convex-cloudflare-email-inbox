import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../packages/mail", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "email-inbox-package-"));
const consumerRoot = join(temporaryRoot, "consumer");
const tarballRoot = join(temporaryRoot, "tarball");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(args: string[], cwd: string) {
  execFileSync(npm, args, { cwd, stdio: "inherit", env: { ...process.env, NODE_PATH: undefined } });
}
mkdirSync(tarballRoot);
cpSync(join(packageRoot, "fixtures", "consumer"), consumerRoot, { recursive: true });
run(["pack", "--ignore-scripts", "--pack-destination", tarballRoot], packageRoot);
const tarballs = readdirSync(tarballRoot).filter((filename) => filename.endsWith(".tgz"));
if (tarballs.length !== 1) throw new Error("Expected exactly one packed component");
run(
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-save",
    join(tarballRoot, tarballs[0]),
  ],
  consumerRoot,
);
run(["exec", "--", "tsc", "-p", "tsconfig.json"], consumerRoot);
run(["exec", "--", "vitest", "run", "consumer.test.ts"], consumerRoot);
console.log(`Packed consumer passed. Artifacts retained at ${temporaryRoot}`);
