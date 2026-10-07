import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const require = createRequire(join(consumerRoot, "package.json"));
const css = readFileSync(
  require.resolve("@samebase/convex-cloudflare-email-inbox-ui/styles.css"),
  "utf8",
);
assert.match(css, /@layer components/);
assert.match(css, /var\(--sb-email-border,/);
assert.doesNotMatch(css, /@apply|@import|@theme|@property|:root|:host|\*\s*[,{]/);
// EmailInbox uploads this file as the owned Worker. It must load with no
// other module and export both handlers.
const workerBundle = await import(
  pathToFileURL(
    join(
      dirname(require.resolve("@samebase/convex-cloudflare-email-inbox/alchemy")),
      "worker.bundle.js",
    ),
  ).href
);
assert.equal(typeof workerBundle.default.email, "function");
assert.equal(typeof workerBundle.default.fetch, "function");
assert.equal(
  (await workerBundle.default.fetch(new Request("https://worker.example/"), {})).status,
  404,
);
run(["exec", "--", "tsc", "-p", "tsconfig.json"], consumerRoot);
run(["exec", "--", "vitest", "run", "consumer.test.ts"], consumerRoot);
console.log(`Packed consumer passed. Artifacts retained at ${temporaryRoot}`);
