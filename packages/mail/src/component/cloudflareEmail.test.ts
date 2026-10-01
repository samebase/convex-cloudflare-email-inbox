// @vitest-environment edge-runtime

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sendCloudflareEmail } from "./cloudflareEmail";
import {
  cloudflareSendReceipt,
  cloudflareSendRejection,
} from "../../tests/cloudflareEmail.fixtures";

const payload = {
  from: "sender@example.com",
  senderName: "Samebase",
  to: ["recipient@example.com"],
  cc: [],
  subject: "Monthly Report",
  text: "Report",
  inReplyTo: "<original@example.com>",
  references: ["<original@example.com>"],
};

beforeEach(() => {
  // Cloudflare 7.2.0 reads process.version when EdgeRuntime is present.
  // Convex exposes web APIs without the EdgeRuntime marker.
  vi.stubGlobal("EdgeRuntime", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Cloudflare structured sending", () => {
  it("uses the sender address and name, reply headers, and all recipient results", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(cloudflareSendReceipt));
    vi.stubGlobal("fetch", request);

    const result = await sendCloudflareEmail({
      apiToken: "test-token",
      accountId: "test-account",
      payload,
    });

    expect(result).toEqual({
      kind: "accepted",
      providerMessageId: cloudflareSendReceipt.result.message_id,
      recipientResults: {
        delivered: cloudflareSendReceipt.result.delivered,
        queued: cloudflareSendReceipt.result.queued,
        permanent_bounces: cloudflareSendReceipt.result.permanent_bounces,
        suppressed_recipients: cloudflareSendReceipt.result.suppressed_recipients,
      },
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/email/sending/send",
    );
    expect(options?.method).toBe("POST");
    const sentBody: unknown = await new Request(url, options).json();
    expect(sentBody).toEqual({
      from: { address: payload.from, name: payload.senderName },
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      headers: { "In-Reply-To": "<original@example.com>", References: "<original@example.com>" },
    });
  });

  it.each([400, 429, 500])(
    "makes one request when the provider returns HTTP %s",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(cloudflareSendRejection, { status }));
      vi.stubGlobal("fetch", request);

      const result = await sendCloudflareEmail({
        apiToken: "test-token",
        accountId: "test-account",
        payload,
      });

      expect(result).toEqual(
        status < 500
          ? { kind: "rejected", code: `cloudflare_http_${status}` }
          : { kind: "unknown" },
      );
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("does not resend after losing the provider response", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Lost response"));
    vi.stubGlobal("fetch", request);

    expect(
      await sendCloudflareEmail({ apiToken: "test-token", accountId: "test-account", payload }),
    ).toEqual({ kind: "unknown" });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    cloudflareSendRejection,
    { ...cloudflareSendReceipt, result: { ...cloudflareSendReceipt.result, queued: null } },
  ])("does not accept an invalid HTTP 200 receipt", async (receipt) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt)));

    expect(
      await sendCloudflareEmail({ apiToken: "test-token", accountId: "test-account", payload }),
    ).toEqual({ kind: "unknown" });
  });

  it("removes unsafe threading values and bounds References to the provider header limit", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(cloudflareSendReceipt));
    vi.stubGlobal("fetch", request);
    const oldId = `<${"a".repeat(1_980)}@example.com>`;
    const newId = `<${"b".repeat(1_980)}@example.com>`;

    await sendCloudflareEmail({
      apiToken: "test-token",
      accountId: "test-account",
      payload: {
        ...payload,
        inReplyTo: "<original@example.com>\r\nBcc: private@example.com",
        references: [oldId, "opaque-provider-id", newId],
      },
    });

    const [url, options] = request.mock.calls[0];
    const sentBody: unknown = await new Request(url, options).json();
    expect(sentBody).toMatchObject({ headers: { References: newId } });
    expect(sentBody).not.toMatchObject({ headers: { "In-Reply-To": expect.anything() } });
  });
});
