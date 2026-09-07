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

  it("omits invalid reply headers and keeps complete references within the provider limit", async () => {
    let sent: unknown;
    const request = new Request("https://mail.example/api/mail/send", {
      method: "POST",
      headers: {
        authorization: "Bearer configured",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        from: "inbox@json.md",
        to: ["person@example.com"],
        cc: [],
        subject: "Reply",
        text: "Body",
        inReplyTo: "<bad\r\nmessage@example.com>",
        references: ["界".repeat(700), "<safe@example.com>"],
      }),
    });
    const environment = {
      MAIL_BRIDGE_SECRET: "configured",
      EMAIL: {
        async send(value: unknown) {
          sent = value;
          return { messageId: "<sent@example.com>" };
        },
      },
    };

    // @ts-expect-error This route does not read the R2 or static asset bindings.
    const response = await worker.fetch(request, environment);

    expect(response.status).toBe(200);
    expect(sent).toMatchObject({ headers: { References: "<safe@example.com>" } });
    expect(sent).not.toMatchObject({ headers: { "In-Reply-To": expect.anything() } });
  });
});
