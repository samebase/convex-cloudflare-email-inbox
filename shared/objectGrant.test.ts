import { describe, expect, it } from "vite-plus/test";
import { createObjectGrant, verifyObjectGrant } from "./objectGrant";

describe("private object grants", () => {
  it("accepts an intact unexpired grant", async () => {
    const grant = await createObjectGrant(
      {
        expiresAt: Date.now() + 60_000,
        r2Key: "mail/json.md/inbox/message/raw.eml",
        filename: "message.eml",
        contentType: "message/rfc822",
      },
      "secret",
    );

    await expect(verifyObjectGrant(grant, "secret")).resolves.toMatchObject({
      filename: "message.eml",
    });
  });

  it("rejects changed, expired, or wrong-key grants", async () => {
    const expired = await createObjectGrant(
      {
        expiresAt: Date.now() - 1,
        r2Key: "mail/object",
        filename: "file.txt",
        contentType: "text/plain",
      },
      "secret",
    );
    const active = await createObjectGrant(
      {
        expiresAt: Date.now() + 60_000,
        r2Key: "mail/object",
        filename: "file.txt",
        contentType: "text/plain",
      },
      "secret",
    );

    await expect(verifyObjectGrant(expired, "secret")).resolves.toBeNull();
    await expect(verifyObjectGrant(active, "wrong-secret")).resolves.toBeNull();
    await expect(verifyObjectGrant(`${active}x`, "secret")).resolves.toBeNull();
  });
});
