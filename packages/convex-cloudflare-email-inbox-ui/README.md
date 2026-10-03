# Cloudflare Email Inbox UI for Convex

A read-only email monitor inside your React app. It reads the records from your app's
`@samebase/convex-cloudflare-email-inbox` component. It needs no separate server or login.

```sh
pnpm add @samebase/convex-cloudflare-email-inbox-ui @samebase/convex-cloudflare-email-inbox convex react
```

## Connect your app

Expose four authorized Convex queries: `listInboxes`, `listHistory`, `getMessage`, and
`getDelivery`. The backend package exports their validators from
`@samebase/convex-cloudflare-email-inbox/monitor`. Each query must check the caller's access
before it calls `EmailInbox`. See the [Mail wrappers](https://github.com/samebase/convex-cloudflare-email-inbox/blob/main/apps/mail/convex/emailMonitor.ts).

Mount the monitor inside your existing Convex provider:

```tsx
import { EmailMonitor } from "@samebase/convex-cloudflare-email-inbox-ui";
import "@samebase/convex-cloudflare-email-inbox-ui/styles.css";
import { api } from "../convex/_generated/api";

export function EmailAdmin() {
  return <EmailMonitor api={api.emailMonitor} />;
}
```

The monitor includes inbox and status filters, cursor pagination, message content, and delivery
details. The host owns authentication, navigation, and access policy. Hiding the route is not an
access check. Keep platform-wide mail restricted to staff; do not grant access to every tenant
administrator.

For downloads, pass an authorized action with arguments `{ object }` and a string URL result:

```tsx
<EmailMonitor api={api.emailMonitor} authorizeDownload={api.objects.authorizeDownload} />
```

`object` is `{ kind: "raw", messageId }` or `{ kind: "attachment", attachmentId }`. The action
must authorize the specific file and return a short-lived HTTP(S) download URL. Without this
action, attachment names and sizes remain visible but no download buttons appear.

## Share the reader

`EmailMessage` renders one message returned by `EmailInbox.getMessage`. The Mail reference app
uses it in its thread reader too. It accepts optional `delivery` data from `getDelivery` and an
`onDownload(object)` callback that returns a signed URL.

## Behavior and styling

- Opening a message does not mark it as read or change any stored record.
- No compose, resend, delete, or inbox-management actions are included.
- Accepted means Cloudflare accepted the message, not that all recipients received it. Details
  show the provider's recorded recipient outcomes. Unknown delivery has no resend action.
- Only plain text is rendered. Email HTML and remote images never enter the app document.
- Namespaced CSS inherits the host font and colors. It uses the host's `--border`, `--muted`, and
  `--muted-foreground` variables when present. It adds no global styles or Tailwind requirement.
- The table loads message metadata. Bodies, attachments, and delivery details load only for the
  selected message. Queries update through Convex subscriptions, without polling.
- Exclude the whole monitor from session recordings, not only its text. Message subjects also
  appear in accessibility attributes. Keep mail content out of analytics and error reports.

The backend component and UI package are Apache-2.0 licensed.
