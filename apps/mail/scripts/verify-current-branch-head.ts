// Samebase source build: v1989
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Refuses a deploy from a commit that is no longer the head of its branch. A re-run of an old
 * workflow run checks out its old commit, and its push would put older code over newer code. The
 * concurrency groups of .github/workflows/deploy.yml order runs but do not refuse a stale one.
 */
export function verifyCurrentBranchHead(
  branch: string,
  commit: string,
  readRemoteHead = (branch: string) => {
    const output = execFileSync(
      "git",
      ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`],
      { encoding: "utf8" },
    );
    const [remoteHead] = output.trim().split(/\s+/, 1);

    if (!remoteHead) {
      throw new Error(`Git did not return a head commit for ${branch}.`);
    }

    return remoteHead;
  },
) {
  const remoteHead = readRemoteHead(branch);

  if (remoteHead !== commit) {
    throw new Error(
      `${commit} is stale: ${branch} now points to ${remoteHead}. Convex was not deployed.`,
    );
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const [branch, commit] = process.argv.slice(2);
  if (!branch || !commit) {
    throw new Error("Usage: node ./scripts/verify-current-branch-head.ts <branch> <commit>");
  }
  verifyCurrentBranchHead(branch, commit);
}
