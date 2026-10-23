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
run(["exec", "--", "tsc", "-p", "tsconfig.json"], consumerRoot);
run(["exec", "--", "vitest", "run", "consumer.test.ts"], consumerRoot);

// EmailInbox points Alchemy at dist/worker/entry.js, and Alchemy bundles it
// in the consumer's deploy. The entry must load with the runtime that a stack
// installs, at the versions of the Mail stack in apps/mail: alchemy, effect,
// and @effect/platform-node. Their Effect support packages must use the same
// workspace versions, because newer releases can require a newer Effect peer.
// The packed tarballs go in again, because an install without them would remove them.
const workspaceRequire = createRequire(new URL("../apps/mail/package.json", import.meta.url));
const alchemyRequire = createRequire(workspaceRequire.resolve("alchemy"));
const platformNodeRequire = createRequire(
  workspaceRequire.resolve("@effect/platform-node/package.json"),
);
const workspaceVersion = (name: string, resolveFrom?: NodeJS.Require) =>
  JSON.parse(
    readFileSync(
      resolveFrom
        ? resolveFrom.resolve(`${name}/package.json`)
        : new URL(`../apps/mail/node_modules/${name}/package.json`, import.meta.url),
      "utf8",
    ),
  ).version;
run(
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-save",
    ...tarballs.map((filename) => join(tarballRoot, filename)),
    ...["alchemy", "effect", "@effect/platform-node"].map(
      (name) => `${name}@${workspaceVersion(name)}`,
    ),
    ...["@effect/sql-d1", "@effect/sql-sqlite-do"].map(
      (name) => `${name}@${workspaceVersion(name, alchemyRequire)}`,
    ),
    `@effect/platform-node-shared@${workspaceVersion("@effect/platform-node-shared", platformNodeRequire)}`,
  ],
  consumerRoot,
);
const entry = await import(
  pathToFileURL(
    join(
      dirname(require.resolve("@samebase/convex-cloudflare-email-inbox/alchemy")),
      "worker",
      "entry.js",
    ),
  ).href
);
assert.equal(typeof entry.inbox, "function");
assert.equal(typeof entry.default.pipe, "function");
const provisioning = await import(
  pathToFileURL(require.resolve("@samebase/convex-cloudflare-email-inbox/alchemy")).href
);
assert.equal(typeof provisioning.EmailInbox, "function");
assert.throws(() => require.resolve("@samebase/alchemy-convex"), { code: "MODULE_NOT_FOUND" });
console.log(`Packed consumer passed. Artifacts retained at ${temporaryRoot}`);
