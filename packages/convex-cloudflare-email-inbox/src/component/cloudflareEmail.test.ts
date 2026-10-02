// @vitest-environment edge-runtime

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sendCloudflareEmail } from "./cloudflareEmail";
import PostalMime from "postal-mime";
import {
  cloudflareSendReceipt,
  cloudflareSendRejection,
} from "../../tests/cloudflareEmail.fixtures";

const payload = {
  from: "sender@example.com",
  senderName: "Samebase",
  to: ["recipient@example.com"],
  cc: [],
  bcc: ["audit@example.com"],
  replyTo: "reply@example.com",
  subject: "Monthly Report",
  text: "Report",
  html: "<p>Report</p>",
  attachments: [],
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
      html: payload.html,
      bcc: payload.bcc,
      reply_to: payload.replyTo,
      headers: { "In-Reply-To": "<original@example.com>", References: "<original@example.com>" },
    });
  });

  it.each([400, 408, 429, 500])(
    "makes one request when the provider returns HTTP %s",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(cloudflareSendRejection, { status }));
      vi.stubGlobal("fetch", request);
      vi.spyOn(Date, "now").mockReturnValue(1_000);

      const result = await sendCloudflareEmail({
        apiToken: "test-token",
        accountId: "test-account",
        payload,
      });

      expect(result).toEqual(
        status === 429
          ? { kind: "throttled", retryAt: 2_000 }
          : status < 500 && status !== 408
            ? { kind: "rejected", code: "cloudflare_10001" }
            : { kind: "unknown" },
      );
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["30", 31_000],
    ["Thu, 01 Jan 1970 00:01:00 GMT", 60_000],
    ["invalid", 2_000],
  ])("respects Retry-After %s without an SDK retry", async (retryAfter, retryAt) => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(cloudflareSendRejection, {
        status: 429,
        headers: { "Retry-After": retryAfter },
      }),
    );
    vi.stubGlobal("fetch", request);

    expect(
      await sendCloudflareEmail({ apiToken: "test-token", accountId: "test-account", payload }),
    ).toEqual({ kind: "throttled", retryAt });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    ["text/plain", "Samebase Mail live attachment check.\n"],
    ["application/octet-stream", "\u0000\u0001\u00ff\r\n"],
  ])(
    "preserves %s attachment bytes through raw MIME without exposing Bcc",
    async (type, content) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(cloudflareSendReceipt));
      vi.stubGlobal("fetch", request);
      const attachment = {
        content: btoa(content),
        filename: `Résumé "Q1" ${"é".repeat(200)}.txt`,
        type,
        disposition: "attachment" as const,
      };
      await sendCloudflareEmail({
        apiToken: "test-token",
        accountId: "test-account",
        payload: { ...payload, subject: "📨".repeat(200), cc: ["copy@example.com"] },
        attachments: [attachment],
      });

      const [url, options] = request.mock.calls[0];
      expect(url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/test-account/email/sending/send_raw",
      );
      const body = await new Request(url, options).json();
      expect(body.recipients).toEqual([...payload.to, "copy@example.com", ...payload.bcc]);
      expect(
        body.mime_message
          .split("\r\n")
          .every((line: string) => new TextEncoder().encode(line).byteLength <= 998),
      ).toBe(true);
      expect(body.mime_message).not.toContain("Bcc:");
      expect(body.mime_message).not.toContain(payload.bcc[0]);
      expect(body.mime_message).toContain("Content-Transfer-Encoding: base64");
      const parsed = await PostalMime.parse(body.mime_message, {
        attachmentEncoding: "arraybuffer",
      });
      expect(parsed.attachments[0]?.filename).toBe(attachment.filename);
      expect(parsed.attachments[0]?.content).toEqual(
        Uint8Array.from(content, (character) => character.charCodeAt(0)).buffer,
      );
      expect(parsed.text).toBe(payload.text);
      expect(parsed.html).toBe(payload.html);
      expect(parsed.inReplyTo).toBe(payload.inReplyTo);
      expect(parsed.references).toBe(payload.references.join(" "));
      expect(parsed.from?.name).toBe(payload.senderName);
      expect(parsed.replyTo?.[0]?.address).toBe(payload.replyTo);
      expect(parsed.subject).toBe("📨".repeat(200));
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
    { success: true, result: {} },
    { ...cloudflareSendReceipt, result: { ...cloudflareSendReceipt.result, queued: null } },
    { ...cloudflareSendReceipt, result: { ...cloudflareSendReceipt.result, message_id: "" } },
    {
      ...cloudflareSendReceipt,
      result: { ...cloudflareSendReceipt.result, suppressed_recipients: null },
    },
  ])("does not accept an invalid HTTP 200 receipt", async (receipt) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt)));

    expect(
      await sendCloudflareEmail({ apiToken: "test-token", accountId: "test-account", payload }),
    ).toEqual({ kind: "unknown" });
  });

  it("accepts the REST guide receipt without inventing a provider ID or suppression result", async () => {
    const result = { delivered: ["recipient@example.com"], queued: [], permanent_bounces: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result })),
    );
    expect(
      await sendCloudflareEmail({ apiToken: "test-token", accountId: "test-account", payload }),
    ).toEqual({
      kind: "accepted",
      recipientResults: result,
    });
  });

  it.each([
    [{ errors: [{ code: 10102, message: "forbidden" }] }, "cloudflare_10102"],
    [{ errors: [] }, "cloudflare_http_403"],
  ])("retains the rejection reason without depending on an error message", async (body, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status: 403 })),
    );
    expect(
      await sendCloudflareEmail({ apiToken: "test-token", accountId: "test-account", payload }),
    ).toEqual({
      kind: "rejected",
      code,
    });
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
