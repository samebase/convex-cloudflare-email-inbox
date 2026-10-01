import { describe, expect, it } from "vite-plus/test";
import { normalizeMailAddress } from "./mailProtocol";

describe("mail address validation", () => {
  it("normalizes a valid bare address", () => {
    expect(normalizeMailAddress(" Person@Example.com ")).toBe("person@example.com");
  });

  it("rejects invalid dot placement", () => {
    expect(() => normalizeMailAddress("a..b@example.com")).toThrow("valid email address");
    expect(() => normalizeMailAddress("person@example..com")).toThrow("valid email address");
  });
});
