import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(
  new URL("../packages/convex-cloudflare-email-inbox", import.meta.url),
);
const uiPackageRoot = fileURLToPath(
  new URL("../packages/convex-cloudflare-email-inbox-ui", import.meta.url),
);
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
run(["pack", "--ignore-scripts", "--pack-destination", tarballRoot], uiPackageRoot);
const tarballs = readdirSync(tarballRoot).filter((filename) => filename.endsWith(".tgz"));
if (tarballs.length !== 2) throw new Error("Expected the component and UI packages");
run(
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-save",
    ...tarballs.map((filename) => join(tarballRoot, filename)),
  ],
  consumerRoot,
);
run(["exec", "--", "tsc", "-p", "tsconfig.json"], consumerRoot);
run(["exec", "--", "vitest", "run", "consumer.test.ts"], consumerRoot);
console.log(`Packed consumer passed. Artifacts retained at ${temporaryRoot}`);
