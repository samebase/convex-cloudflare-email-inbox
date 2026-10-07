import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmailMessage, type EmailButtonProps, type Message } from "./index";

const message: Message = {
  _id: "message-1",
  inboxId: "inbox-1",
  threadId: "thread-1",
  direction: "outbound",
  status: "accepted",
  from: "notifications@example.com",
  replyTo: null,
  replyRecipient: "person@example.net",
  to: ["person@example.net"],
  cc: [],
  bcc: [],
  subject: "Receipt",
  occurredAt: 1_700_000_000_000,
  rfcMessageId: "receipt@example.com",
  references: [],
  bodyText: "<script>alert('unsafe')</script>",
  bodyHtml: '<img src="https://tracker.invalid/pixel">',
  bodyTruncated: false,
  rawAvailable: false,
  attachments: [
    { _id: "attachment-1", filename: "receipt.txt", mimeType: "text/plain", byteSize: 37 },
  ],
};

describe("EmailMessage", () => {
  it("renders text safely without HTML, remote images, or unavailable download actions", () => {
    const html = renderToStaticMarkup(<EmailMessage message={message} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("tracker.invalid");
    expect(html).toContain("receipt.txt");
    expect(html).toContain("37 bytes");
    expect(html).not.toContain("<button");
  });

  it("distinguishes acceptance from delivery and shows each recipient outcome", () => {
    const html = renderToStaticMarkup(
      <EmailMessage
        message={message}
        delivery={{
          kind: "accepted",
          acceptedAt: message.occurredAt,
          recipientResults: {
            delivered: ["delivered@example.net"],
            queued: ["queued@example.net"],
            permanent_bounces: ["bounce@example.net"],
            suppressed_recipients: ["suppressed@example.net"],
          },
        }}
      />,
    );
    expect(html).toContain("Acceptance does not confirm delivery to every recipient");
    for (const outcome of [
      "Delivered",
      "Queued by Cloudflare",
      "Permanently bounced",
      "Suppressed",
    ]) {
      expect(html).toContain(outcome);
    }
    for (const recipient of ["delivered", "queued", "bounce", "suppressed"]) {
      expect(html).toContain(`${recipient}@example.net`);
    }
  });

  it("warns against duplicate sends when delivery is unknown", () => {
    const html = renderToStaticMarkup(
      <EmailMessage
        message={message}
        delivery={{ kind: "unknown", observedAt: message.occurredAt }}
      />,
    );
    expect(html).toContain("Check Cloudflare before sending again");
    expect(html).not.toContain("<button");
  });

  it("offers attachments and raw mail only when the host supplies download authorization", () => {
    const html = renderToStaticMarkup(
      <EmailMessage
        message={{ ...message, direction: "inbound", status: "received", rawAvailable: true }}
        onDownload={async () => "https://files.example.com/download"}
      />,
    );
    expect(html).toContain(">receipt.txt</button>");
    expect(html).toContain("Download raw message");
    expect(html).not.toContain("files.example.com");
  });

  it("uses the host button for both attachment and raw downloads", () => {
    function HostButton({ appearance, ...props }: EmailButtonProps) {
      return <button {...props} className={appearance === "text" ? "host-text" : "host-action"} />;
    }
    const html = renderToStaticMarkup(
      <EmailMessage
        message={{ ...message, rawAvailable: true }}
        onDownload={async () => "https://files.example.com/download"}
        controls={{ Button: HostButton }}
      />,
    );
    expect(html).toContain('type="button" class="host-text">receipt.txt</button>');
    expect(html).toContain('type="button" class="host-action">Download raw message</button>');
    expect(html).not.toContain("sb-email-button");
  });
});
