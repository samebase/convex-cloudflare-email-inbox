import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { completeIngressRequest } from "../convex/components/mail/mailProtocol";
import { receiveEmail } from "./inbound";

function rawStream(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function testMessage(raw: string, recipient = "inbox@json.md", sender = "sender@example.com") {
  let rejection = "";
  return {
    message: {
      from: sender,
      to: recipient,
      raw: rawStream(raw),
      rawSize: new TextEncoder().encode(raw).byteLength,
      setReject(reason: string) {
        rejection = reason;
      },
    },
    rejection: () => rejection,
  };
}

function testEnvironment(storedKeys: string[]) {
  return {
    CONVEX_SITE_URL: "https://convex.example",
    MAIL_BRIDGE_SECRET: "test-secret",
    MAIL_STORAGE: {
      async put(key: string) {
        storedKeys.push(key);
        return undefined;
      },
    },
  };
}

function messageWithAttachment() {
  return [
    "From: Sender <sender@example.com>",
    "Subject: Receipt",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="mail-boundary"',
    "",
    "--mail-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Attached receipt.",
    "--mail-boundary",
    'Content-Type: text/plain; name="invoice.txt"',
    'Content-Disposition: attachment; filename="invoice.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    "cGFpZA==",
    "--mail-boundary--",
    "",
  ].join("\r\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email ingress Worker", () => {
  it("rejects an unknown envelope recipient without an R2 write", async () => {
    const storedKeys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ kind: "reject", reason: "unknown" }, { status: 200 })),
    );
    const fixture = testMessage(
      "From: Sender <sender@example.com>\r\n\r\nHello",
      "missing@json.md",
    );

    await receiveEmail(fixture.message, testEnvironment(storedKeys));

    expect(fixture.rejection()).toBe("Unknown inbox");
    expect(storedKeys).toEqual([]);
  });

  it("does not rewrite R2 for a committed duplicate", async () => {
    const storedKeys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ kind: "duplicate" })),
    );
    const fixture = testMessage("From: Sender <sender@example.com>\r\n\r\nHello");

    await receiveEmail(fixture.message, testEnvironment(storedKeys));

    expect(fixture.rejection()).toBe("");
    expect(storedKeys).toEqual([]);
  });

  it("routes by the SMTP envelope and stores raw mail plus named attachments", async () => {
    const storedKeys: string[] = [];
    let completedRecipient = "";
    let completedReplyTo = "";
    const raw = messageWithAttachment().replace(
      "Subject: Receipt",
      "To: different@example.com\r\nReply-To: Reply <reply@example.com>\r\nSubject: Receipt\r\nMessage-ID: <receipt@example.com>",
    );
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        call += 1;
        if (call === 1) {
          return Response.json({
            kind: "ingest",
            rawR2Key: `mail/json.md/inbox/messages/${"f".repeat(64)}/raw.eml`,
          });
        }
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body");
        }
        const request = completeIngressRequest.parse(JSON.parse(init.body));
        completedRecipient = request.recipient;
        completedReplyTo = request.replyToAddress ?? "";
        return Response.json({ kind: "committed" });
      }),
    );
    const fixture = testMessage(raw, "inbox@json.md", "bounce@example.net");

    await receiveEmail(fixture.message, testEnvironment(storedKeys));

    expect(completedRecipient).toBe("inbox@json.md");
    expect(completedReplyTo).toBe("reply@example.com");
    expect(storedKeys).toEqual([
      `mail/json.md/inbox/messages/${"f".repeat(64)}/raw.eml`,
      `mail/json.md/inbox/messages/${"f".repeat(64)}/attachments/001-invoice.txt`,
    ]);
  });

  it("uses the parsed From address before a different envelope sender", async () => {
    let completedReplyTo: string | null = null;
    const rawR2Key = `mail/json.md/inbox/messages/${"f".repeat(64)}/raw.eml`;
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        call += 1;
        if (call === 1) {
          return Response.json({ kind: "ingest", rawR2Key });
        }
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body");
        }
        completedReplyTo = completeIngressRequest.parse(JSON.parse(init.body)).replyToAddress;
        return Response.json({ kind: "committed" });
      }),
    );
    const fixture = testMessage(
      "From: Person <person@example.com>\r\nSubject: Hello\r\n\r\nBody",
      "inbox@json.md",
      "bounce@example.net",
    );

    await receiveEmail(fixture.message, testEnvironment([]));

    expect(completedReplyTo).toBe("person@example.com");
  });

  it("accepts a bounce with an empty envelope sender", async () => {
    let completedReplyTo: string | null = "not-null";
    const rawR2Key = `mail/json.md/inbox/messages/${"f".repeat(64)}/raw.eml`;
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        call += 1;
        if (call === 1) {
          return Response.json({ kind: "ingest", rawR2Key });
        }
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body");
        }
        completedReplyTo = completeIngressRequest.parse(JSON.parse(init.body)).replyToAddress;
        return Response.json({ kind: "committed" });
      }),
    );
    const fixture = testMessage("Subject: Delivery status\r\n\r\nBounced", "inbox@json.md", "");

    await receiveEmail(fixture.message, testEnvironment([]));

    expect(completedReplyTo).toBeNull();
  });

  it("caps overlong MIME metadata before the Convex handoff", async () => {
    let completion: unknown;
    const rawR2Key = `mail/json.md/inbox/messages/${"f".repeat(64)}/raw.eml`;
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        call += 1;
        if (call === 1) {
          return Response.json({ kind: "ingest", rawR2Key });
        }
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body");
        }
        completion = completeIngressRequest.parse(JSON.parse(init.body));
        return Response.json({ kind: "committed" });
      }),
    );
    const longName = "n".repeat(2_000);
    const fixture = testMessage(
      `From: ${longName} <person@example.com>\r\nSubject: ${"s".repeat(2_000)}\r\n\r\nBody`,
    );

    await receiveEmail(fixture.message, testEnvironment([]));

    expect(completion).toMatchObject({
      parse: { kind: "parsed" },
      replyToAddress: "person@example.com",
      subject: "s".repeat(998),
    });
  });

  it("leaves an ingress reservation incomplete when an attachment write fails", async () => {
    const rawR2Key = `mail/json.md/inbox/messages/${"f".repeat(64)}/raw.eml`;
    const fetchMock = vi.fn(async () => Response.json({ kind: "ingest", rawR2Key }));
    vi.stubGlobal("fetch", fetchMock);
    let putCount = 0;
    const environment = testEnvironment([]);
    environment.MAIL_STORAGE.put = async () => {
      putCount += 1;
      if (putCount === 2) {
        throw new Error("R2 attachment write failed");
      }
      return undefined;
    };
    const fixture = testMessage(messageWithAttachment());

    await expect(receiveEmail(fixture.message, environment)).rejects.toThrow(
      "R2 attachment write failed",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.rejection()).toBe("");
  });
});
