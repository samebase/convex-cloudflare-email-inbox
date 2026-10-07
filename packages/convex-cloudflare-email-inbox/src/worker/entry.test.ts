import { describe, expect, it } from "vite-plus/test";
import worker from "./entry.js";

function environment(secret: string) {
  return {
    CONVEX_SITE_URL: "https://convex.example",
    MAIL_BRIDGE_SECRET: secret,
    MAIL_STORAGE: {
      put: async () => {
        throw new Error("Storage is not reached");
      },
      get: async () => {
        throw new Error("Storage is not reached");
      },
    },
  };
}

describe("owned Worker entry", () => {
  it("serves only object downloads", async () => {
    const other = await worker.fetch(new Request("https://worker.example/"), environment("set"));
    expect(other.status).toBe(404);
    const download = await worker.fetch(
      new Request("https://worker.example/api/mail/object?grant=invalid"),
      environment("set"),
    );
    expect(download.status).toBe(404);
    const unconfigured = await worker.fetch(
      new Request("https://worker.example/api/mail/object?grant=invalid"),
      environment(""),
    );
    expect(unconfigured.status).toBe(503);
  });

  it("rejects mail that it cannot store", async () => {
    const raw = new Blob(["Subject: Hello\r\n\r\nHello\r\n"]);
    let rejection = "";
    await worker.email(
      {
        from: "sender@example.com",
        to: "inbox@example.com",
        raw: raw.stream(),
        rawSize: raw.size,
        setReject(reason) {
          rejection = reason;
        },
      },
      environment(""),
    );
    expect(rejection).toBe("Mail storage is temporarily unavailable");
  });
});
