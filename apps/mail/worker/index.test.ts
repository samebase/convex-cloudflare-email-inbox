/// <reference types="node" />
import { readFileSync } from "node:fs";
import { parseConfigFileTextToJson } from "typescript";
import { describe, expect, it } from "vite-plus/test";
import worker from "./index";

describe("Worker object downloads", () => {
  it("routes object downloads through the Worker before SPA assets", () => {
    const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const parsed = parseConfigFileTextToJson("wrangler.jsonc", source);
    const config: unknown = parsed.config;
    expect(parsed.error).toBeUndefined();
    expect(config).toMatchObject({ assets: { run_worker_first: ["/api/mail/object"] } });
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
