import { describe, expect, it } from "vite-plus/test";
import worker from "./index";

describe("Worker HTTP authorization", () => {
  it("does not accept Bearer undefined when the bridge secret is missing", async () => {
    const request = new Request("https://mail.example/api/mail/send", {
      method: "POST",
      headers: { authorization: "Bearer undefined" },
    });

    // @ts-expect-error Authentication returns before the unused runtime bindings are read.
    const response = await worker.fetch(request, { MAIL_BRIDGE_SECRET: "" });

    expect(response.status).toBe(503);
  });

  it("rejects a wrong bridge secret before it sends mail", async () => {
    const request = new Request("https://mail.example/api/mail/send", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });

    // @ts-expect-error Authentication returns before the unused runtime bindings are read.
    const response = await worker.fetch(request, { MAIL_BRIDGE_SECRET: "configured" });

    expect(response.status).toBe(401);
  });

  it("does not read R2 when the object signing secret is missing", async () => {
    const request = new Request("https://mail.example/api/mail/object?grant=invalid");

    // @ts-expect-error Configuration validation returns before the unused bindings are read.
    const response = await worker.fetch(request, { MAIL_BRIDGE_SECRET: "" });

    expect(response.status).toBe(503);
  });
});
