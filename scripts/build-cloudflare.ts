// Samebase source build: v2059
/// <reference types="node" />
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const vitePlusEntrypoint = fileURLToPath(import.meta.resolve("vite-plus/bin"));
const wranglerEntrypoint = fileURLToPath(
  new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")),
);
const ensureConvexAuthEntrypoint = fileURLToPath(
  new URL("./ensure-convex-auth.ts", import.meta.url),
);
const WORKERS_BUILD_COMMAND = "pnpm run build:app && node ./scripts/verify-current-branch-head.ts";

type CloudflareBuildPlan =
  | {
      kind: "app";
      buildArgs: readonly string[];
    }
  | {
      kind: "production";
      authArgs: readonly string[];
      deployArgs: readonly string[];
    }
  | {
      kind: "preview";
      authArgs: readonly string[];
      deployArgs: readonly string[];
      previewName: string;
    };

function runNode(entrypoint: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${entrypoint} exited with signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${entrypoint} failed with exit code ${code ?? 1}`));
    });
  });
}

function isWorkersBuild(env: NodeJS.ProcessEnv) {
  return env["WORKERS_CI"] === "1" || env["WORKERS_CI"] === "true";
}

function readWorkersBuildBranch(env: NodeJS.ProcessEnv) {
  const branch = env["WORKERS_CI_BRANCH"];
  if (!branch) {
    throw new Error("Workers Builds must provide WORKERS_CI_BRANCH before Convex deploys.");
  }
  return branch;
}

function requireConvexDeployKey(env: NodeJS.ProcessEnv, branch: string) {
  if (env["CONVEX_DEPLOY_KEY"]) {
    return;
  }

  const keyKind =
    branch === "main"
      ? "production deploy key with deployment:deploy, deployment:env:view, deployment:env:write, and deployment:data:view permissions"
      : "project Preview deploy key";
  throw new Error(
    `Set CONVEX_DEPLOY_KEY in the Cloudflare build settings for ${branch}. Use a Convex ${keyKind}.`,
  );
}

export function selectCloudflareBuildPlan(env: NodeJS.ProcessEnv): CloudflareBuildPlan {
  if (!isWorkersBuild(env)) {
    return {
      kind: "app",
      buildArgs: ["run", "build:app"],
    };
  }

  const branch = readWorkersBuildBranch(env);
  requireConvexDeployKey(env, branch);

  if (branch === "main") {
    return {
      kind: "production",
      deployArgs: ["exec", "convex", "deploy", "--cmd", WORKERS_BUILD_COMMAND],
      authArgs: [],
    };
  }

  return {
    kind: "preview",
    previewName: branch,
    deployArgs: [
      "exec",
      "convex",
      "deploy",
      "--preview-name",
      branch,
      "--cmd",
      WORKERS_BUILD_COMMAND,
    ],
    authArgs: ["--preview-name", branch],
  };
}

export async function main(env: NodeJS.ProcessEnv = process.env) {
  const plan = selectCloudflareBuildPlan(env);
  await runNode(wranglerEntrypoint, ["types"], env);

  if (plan.kind === "app") {
    await runNode(vitePlusEntrypoint, plan.buildArgs, env);
    return;
  }

  await runNode(vitePlusEntrypoint, plan.deployArgs, env);
  await runNode(ensureConvexAuthEntrypoint, plan.authArgs, env);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
