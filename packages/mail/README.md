# Convex Cloudflare Email Inbox

`@samebase/convex-cloudflare-email-inbox` stores inboxes, threads, messages, and delivery history in
a Convex component. It sends through the official Cloudflare Email Service SDK in Convex's default
runtime. Sending does not require a Worker or R2 bucket.

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
  clientRequestId: "signup-notification-stable-request-id",
  to: ["person@example.net"],
  subject: "Welcome",
  text: "Your account is ready.",
});
```

The default inbox is created once. Every send creates a thread, message, body, and delivery record.
Pass `inboxId` to use an existing inbox, and `threadId`, `inReplyTo`, and `references` to reply.
`cc` and `senderName` are optional. This first version sends plain text only.

`send` waits for the provider result and returns `messageId` alongside the delivery state. This is
the component's stored message ID, distinct from Cloudflare's `providerMessageId` on accepted sends.
Use it to retrieve the retained delivery record. `enqueue(ctx, options)` runs from a mutation, records the
message and schedules sending in the same transaction, then returns its message ID. Use a stable
`clientRequestId` for retries of the same logical operation. Reusing it with a different message
fails. Repeating the same request returns the existing record without sending twice.

Delivery states are `queued`, `sending`, `accepted`, `rejected`, or `unknown`. Accepted messages
retain Cloudflare's `delivered`, `queued`, `permanent_bounces`, and `suppressed_recipients` lists.
Accepted means the provider processed the request, not that every recipient received it. Inspect
the lists when the caller needs delivery confirmation.

The SDK makes one request with a 30-second timeout and no retries. A lost response, server error,
or malformed receipt becomes `unknown`. A watchdog also marks interrupted sends `unknown`.
There is no automatic resend because Cloudflare does not document an idempotent send API.

Read history through `components.mail.inboxes.list`, `components.mail.mail.listThreads`, and
`components.mail.mail.listMessages`. Read a delivery state through `components.mail.delivery.get`.
Component functions are internal to the installing app. The app must authorize any public wrappers.
History has no automatic expiry; the installing app owns access and retention policy.

## Receiving

Receiving is optional. The reference Mail app in this repository supplies a Cloudflare email
Worker, authenticated ingress endpoints, and R2 storage for complete `.eml` files and named
attachments. It uses the package's `/protocol` export and the component's `ingress.begin` and
`ingress.complete` functions. Unknown inboxes are rejected, and repeated raw messages are deduplicated.
The package does not provision Cloudflare routing, Worker secrets, or storage for you.

## Tests

```ts
import { register } from "@samebase/convex-cloudflare-email-inbox/test";

const t = convexTest(appSchema, modules);
register(t, "mail");
```

The test helper uses Vite's module glob support and registers the component's actual schema and
functions. Mock `fetch` in transport tests so tests never send real email.
