import { describe, expect, it } from "vite-plus/test";
import { worker as workerConfig } from "../cloudflare.config";
import worker from "./index";

describe("Worker object downloads", () => {
  it("routes object downloads through the Worker before SPA assets", () => {
    expect(workerConfig.assets.runWorkerFirst).toEqual(["/api/mail/object"]);
  });

  it("does not read R2 when the object signing secret is missing", async () => {
    const request = new Request("https://mail.example/api/mail/object?grant=invalid");
    // @ts-expect-error Configuration validation returns before the unused bindings are read.
    const response = await worker.fetch(request, { MAIL_BRIDGE_SECRET: "" });
    expect(response.status).toBe(503);
  });
  it("does not read R2 for an invalid object grant", async () => {
    const request = new Request("https://mail.example/api/mail/object?grant=invalid");
    // @ts-expect-error Grant validation returns before the unused bindings are read.
    const response = await worker.fetch(request, { MAIL_BRIDGE_SECRET: "configured" });
    expect(response.status).toBe(404);
  });
});
