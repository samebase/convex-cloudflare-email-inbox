// Samebase source build: v1989
import { describe, expect, it } from "vite-plus/test";

import { verifyCurrentBranchHead } from "./verify-current-branch-head.ts";

describe("verify-current-branch-head", () => {
  it("accepts the commit that the branch points to", () => {
    expect(() => verifyCurrentBranchHead("main", "abc123", () => "abc123")).not.toThrow();
  });

  it("refuses a commit that the branch no longer points to", () => {
    expect(() => verifyCurrentBranchHead("feature", "abc123", () => "def456")).toThrow(
      "abc123 is stale: feature now points to def456. Convex was not deployed.",
    );
  });

  it("reads the head of the named branch", () => {
    const branches: string[] = [];
    verifyCurrentBranchHead("nicu-preview", "abc123", (branch) => {
      branches.push(branch);
      return "abc123";
    });
    expect(branches).toEqual(["nicu-preview"]);
  });
});
