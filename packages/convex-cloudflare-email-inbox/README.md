# Convex Cloudflare Email Inbox

`@samebase/convex-cloudflare-email-inbox` stores inboxes, threads, messages, and delivery history in
a Convex component. It sends through the official Cloudflare Email Service SDK in Convex's default
runtime. Sending without attachments does not require a Worker or R2 bucket. Receiving stores the
complete raw email and named attachments in your R2 bucket, with inbox data in your Convex deployment.

The first registry release is pending. Use a workspace dependency or local link until publication.

## Install

```sh
pnpm add @samebase/convex-cloudflare-email-inbox convex
```

Install the component in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import mail from "@samebase/convex-cloudflare-email-inbox/convex.config.js";

const app = defineApp({
  env: {
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
  },
});
app.use(mail, {
  env: {
    CLOUDFLARE_EMAIL_API_TOKEN: app.env.CLOUDFLARE_EMAIL_API_TOKEN,
    CLOUDFLARE_EMAIL_ACCOUNT_ID: app.env.CLOUDFLARE_EMAIL_ACCOUNT_ID,
  },
});
export default app;
```

Set the two environment variables in the application's Convex deployment. The token needs
Cloudflare Email Sending permission for the configured account, and the sender domain must be
verified with Cloudflare Email Service. Never pass these credentials in message arguments.

## Send and retain history

Use the client in trusted server functions:

```ts
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import { components } from "./_generated/api";

const email = new EmailInbox(components.mail, {
  defaultInbox: {
    address: "notifications@example.com",
    label: "Notifications",
    senderName: "Example",
  },
});

// Inside an action handler:
const outcome = await email.send(ctx, {
  idempotencyKey: "signup:user-123",
  to: ["person@example.net"],
  subject: "Welcome",
  text: "Your account is ready.",
  html: "<p>Your account is ready.</p>",
});
```

The default inbox is created once. Every new send creates a thread and retained message. Pass
`inboxId` or `from` to use an existing inbox. `from` accepts an address or `{ address, name }`.
It must match a known inbox; it does not create or authorize an arbitrary sender.

The payload supports `to`, `cc`, `bcc`, `replyTo`, `subject`, `text`, `html`, and `attachments`.
Provide a nonempty text or HTML body. Text and HTML together are limited to 512 KiB. Replies and new
messages have the same content options. Recipient addresses are arrays of strings; Reply-To is one
address. This version requires at least one `to` recipient and permits 50 total recipients.

`send` starts a delivery attempt and returns `messageId` alongside the current delivery state. This is
the component's stored message ID, distinct from Cloudflare's optional `providerMessageId` on accepted sends.
Use it to retrieve the retained delivery record. `enqueue(ctx, options)` runs from a mutation, records the
message and schedules sending in the same transaction, then returns its message ID. Use a stable
`idempotencyKey` for retries of the same logical operation, scoped to its sending inbox. Use 1 to 120
characters. Reusing it with a different message
fails. Repeating the same request returns the existing record without sending twice.

Delivery states are `queued`, `sending`, `accepted`, `rejected`, or `unknown`. Accepted messages
retain Cloudflare's `delivered`, `queued`, and `permanent_bounces` lists. The provider ID and
`suppressed_recipients` list are retained when returned; neither is invented when absent.
Accepted means the provider processed the request, not that every recipient received it. Inspect
the lists when the caller needs delivery confirmation.

Rejected sends retain the first numeric Cloudflare error code, such as `cloudflare_10102`, or an
HTTP status fallback. Claim and completion mutations are private to the component.

The SDK makes one request per attempt, with a 30-second timeout and SDK retries disabled. Confirmed
HTTP 429 responses schedule a retry, at most three total provider attempts. `Retry-After` is respected;
delays beyond 24 hours are rejected instead of retried early. A throttled `send` can return `queued`
with `notBefore`. Report that as pending, not failure or acceptance. Reuse its key instead of creating
another message. A concurrent caller can also see `sending`.

HTTP 408, lost responses, server errors, or malformed receipts become `unknown`. A watchdog marks
interrupted sends `unknown`. These outcomes never retry automatically. Attempt IDs protect later
retries from stale watchdogs and completion calls. A late conclusive receipt can settle the same
unknown attempt. There is no exactly-once provider guarantee.

## Inboxes, history, and replies

```ts
const inboxId = await email.createInbox(ctx, { address: "support@example.com", label: "Support" });
const inboxes = await email.listInboxes(ctx);
const threads = await email.listThreads(ctx, {
  inboxId,
  paginationOpts: { cursor: null, numItems: 25 },
});
const messages = await email.listMessages(ctx, {
  threadId,
  paginationOpts: { cursor: null, numItems: 10 },
});
const message = await email.getMessage(ctx, { messageId });
const thread = await email.getThread(ctx, { threadId });
const delivery = await email.getDelivery(ctx, { messageId });
await email.markThreadRead(ctx, { threadId });

// Inside a mutation. Reads the parent and derives recipient, subject and RFC headers atomically.
const replyId = await email.reply(ctx, {
  messageId,
  idempotencyKey: "reply:ticket-123",
  text: "Thanks for the report.",
});
```

Reply accepts optional `to` and `subject` overrides. Bcc recipients are not copied from the parent.
`replyTo` in a message view is the Reply-To header; `replyRecipient` is the suggested recipient for a
reply, including the original recipient for outbound mail. `bodyHtml` contains unsanitized original
outgoing HTML. Render it in an isolated viewer, never inject it directly into your application.
`bodyText` includes a plain-text fallback for HTML-only mail. The reference Mail app displays text.

Thread and message queries support Convex pagination. `listInboxes` returns up to 100 inboxes in
creation order. Queries read local data and can be wrapped in reactive app queries. Component
functions are internal to the installing app. The app must authorize every public wrapper, including
inbox selection and file access. History has no automatic expiry; the app owns retention policy.

## Named attachments in R2

Store a file through your trusted Worker code before enqueueing it:

```ts
import { storeAttachment } from "@samebase/convex-cloudflare-email-inbox/r2";

const attachment = await storeAttachment(env.MAIL_STORAGE, {
  filename: "receipt.pdf",
  contentType: "application/pdf",
  content: pdfBytes, // ArrayBuffer
});
// Pass attachment to a trusted Convex function, then include it in send/enqueue/reply:
// attachments: [attachment]
```

The serializable descriptor is `{ r2Key, filename, contentType, byteSize, sha256 }`. No file bytes or
temporary URL enter the queue. Keys contain the content hash and a readable filename. Keep referenced
objects; the component does not delete R2 files or create an upload endpoint for your app.

For attachment sends, declare optional `MAIL_WORKER_URL` and `MAIL_BRIDGE_SECRET` string env values in
the app's Convex config and pass them through `app.use(mail, { env: ... })`, as with sending credentials.
Set them in the Convex deployment. Mount `downloadObject` at `/api/mail/object` in the Worker below.
The component creates a fresh short-lived grant, loads the file, and verifies its hash and size before
contacting Cloudflare. Missing or changed objects produce `rejected`, not an uncertain send.

Cloudflare currently allows 32 attachments and a 5 MiB outbound email, including encoded attachments.
Base64 adds overhead, so a 5 MiB source file will not fit. The component rejects an oversized encoded
request before sending. See [Cloudflare sending limits](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/).

## Receiving

Receiving is optional. Mount the supported package helpers in your app:

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { registerIngressRoutes } from "@samebase/convex-cloudflare-email-inbox/receiving";
import { components, internal } from "./_generated/api";

const http = httpRouter();
registerIngressRoutes(http, components.mail, {
  secret: () => process.env.MAIL_BRIDGE_SECRET,
  onMessageReceived: internal.email.received, // Optional internal action
});
export default http;
```

The optional action receives `{ messageId, inboxId, threadId }` and returns `null`. A dispatcher is
scheduled in the same transaction that stores the incoming email. A failing or removed callback
cannot delete the committed mail. Duplicates do not schedule it again. Hook failures are visible in
Convex scheduled-function logs; there is no automatic callback retry. Make external effects idempotent
if you choose to replay a failed callback.

```ts
// Worker entrypoint. Env is generated from your Wrangler configuration.
import { downloadObject, receiveEmail } from "@samebase/convex-cloudflare-email-inbox/worker";

export default {
  async email(message, env) {
    try {
      await receiveEmail(message, env);
    } catch {
      message.setReject("Mail storage is temporarily unavailable");
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/mail/object") {
      return await downloadObject(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

The Worker needs `MAIL_STORAGE` as its R2 binding, `CONVEX_SITE_URL` as the app's Convex HTTP URL,
and `MAIL_BRIDGE_SECRET` matching Convex. Configure Cloudflare Email Routing to invoke its email
handler. `createInbox` creates the local mailbox, not DNS records or a Cloudflare route.

Raw `.eml` files and named MIME attachments remain in R2. Parsed text and mailbox metadata live in
Convex. Unknown inboxes are rejected. Repeated raw messages are deduplicated within the recipient's
inbox. A parse failure retains the raw message. Partial R2 writes can leave objects without a completed
message; replaying the same raw mail resumes its reservation. Mail additionally supports forwarding
to a verified recovery address. Provisioning, recovery policy, and orphan cleanup belong to the app.

## Tests

The October 2 live test verified attachment bytes, matching provider and received message IDs, and
reply threading between two owner-controlled Cloudflare inboxes. Attachment sends use raw MIME with
base64 file parts; other sends use Cloudflare's structured API. An independent external mailbox
roundtrip remains a publication check. If the provider omits a usable message ID, replies to
conversations started here can form a separate thread. That case remains a release blocker.

```ts
import { register } from "@samebase/convex-cloudflare-email-inbox/test";

const t = convexTest(appSchema, modules);
register(t, "mail");
```

The test helper uses Vite's module glob support and registers the component's actual schema and
functions. Mock `fetch` in transport tests so tests never send real email.
