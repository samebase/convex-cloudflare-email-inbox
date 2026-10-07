import { describe, expect, it } from "vite-plus/test";
import { inboxName } from "./alchemy.js";

describe("inboxName", () => {
  it("names the Worker and the bucket after the Convex deployment", () => {
    expect(inboxName("happy-otter-123")).toBe("mail-happy-otter-123");
    expect(inboxName("Happy-Otter-123")).toBe("mail-happy-otter-123");
  });

  it("keeps the name within 54 characters", () => {
    expect(inboxName("a".repeat(60))).toHaveLength(54);
  });
});
