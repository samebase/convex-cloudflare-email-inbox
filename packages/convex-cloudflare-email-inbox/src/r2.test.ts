import { describe, expect, it, vi } from "vite-plus/test";
import { createObjectGrant, storeAttachment, verifyObjectGrant } from "./r2.js";

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

describe("outgoing R2 attachments", () => {
  it("stores named content under stable content-addressed keys", async () => {
    const put = vi.fn(async () => undefined);
    const input = {
      filename: "receipt.txt",
      contentType: "text/plain",
      content: new TextEncoder().encode("paid").buffer,
    };
    const first = await storeAttachment({ put }, input);
    const replay = await storeAttachment({ put }, input);
    const changed = await storeAttachment(
      { put },
      {
        ...input,
        content: new TextEncoder().encode("unpaid").buffer,
      },
    );

    expect(replay).toEqual(first);
    expect(changed.r2Key).not.toBe(first.r2Key);
    expect(first).toEqual({
      r2Key: `mail/outbound/${first.sha256}/receipt.txt`,
      filename: "receipt.txt",
      contentType: "text/plain",
      byteSize: 4,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(put).toHaveBeenNthCalledWith(1, first.r2Key, input.content, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { originalFilename: "receipt.txt", sha256: first.sha256 },
    });
  });

  it("does not store oversized files or unsafe metadata", async () => {
    const put = vi.fn(async () => undefined);
    await expect(
      storeAttachment(
        { put },
        {
          filename: "receipt.txt",
          contentType: "text/plain",
          content: new ArrayBuffer(5 * 1_024 * 1_024 + 1),
        },
      ),
    ).rejects.toThrow("5 MiB");
    await expect(
      storeAttachment(
        { put },
        {
          filename: "receipt.txt",
          contentType: "text/plain\r\nx-header: injected",
          content: new ArrayBuffer(0),
        },
      ),
    ).rejects.toThrow();
    for (const filename of ["../receipt.txt", "receipt\n.txt"]) {
      await expect(
        storeAttachment(
          { put },
          {
            filename,
            contentType: "text/plain",
            content: new ArrayBuffer(0),
          },
        ),
      ).rejects.toThrow();
    }
    expect(put).not.toHaveBeenCalled();
  });
});
