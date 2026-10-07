# Cloudflare Email Inbox UI for Convex

A read-only email monitor inside your React app. It reads the records from your app's
`@samebase/convex-cloudflare-email-inbox` component. It needs no separate server or login.

This package is one of three imports. The backend package supplies the other two:
`convex.config.js`, the Convex component, and `./alchemy`, the Alchemy function that wires the
Worker and the Convex deployment.

```ts
import mail from "@samebase/convex-cloudflare-email-inbox/convex.config.js";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox/alchemy";
import { EmailMonitor } from "@samebase/convex-cloudflare-email-inbox-ui";
```

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

## Styling and host controls

The optional `styles.css` is compiled CSS. It uses Tailwind's spacing and type scale, but your
app does not need Tailwind or a build step for the package. All rules are scoped to `sb-email`
classes in the `components` cascade layer. There is no global reset. Host Tailwind utilities
can override these rules. Omit the stylesheet to style the same markup yourself.

The UI inherits text color and font. Map these three optional tokens on a parent element:

| Token                 | Purpose                                       | Default   |
| --------------------- | --------------------------------------------- | --------- |
| `--sb-email-border`   | Table and reader separators, default controls | `#d4d4d4` |
| `--sb-email-muted`    | Secondary text                                | `#525252` |
| `--sb-email-selected` | Selected message row                          | `#f5f5f5` |

Values must be complete CSS colors. For an HSL-channel variable, use
`--sb-email-border: hsl(var(--border))`. For a variable containing `oklch(...)` or another
complete color, use `--sb-email-border: var(--border)`. Map the host's dark-mode tokens too.

To use your app's controls, pass `controls={{ Button, Select }}`. Both are optional.
`EmailMessage` also accepts `controls={{ Button }}`. Define these components outside the
render function so that they keep their identity and focus:

```tsx
import type { EmailButtonProps } from "@samebase/convex-cloudflare-email-inbox-ui";
import { Button } from "./ui/button";

function EmailButton({ appearance, ...props }: EmailButtonProps) {
  return <Button {...props} variant={appearance === "text" ? "link" : "outline"} />;
}

const controls = { Button: EmailButton };

// In your authorized page:
<EmailMonitor api={api.emailMonitor} controls={controls} />;
```

- `EmailButtonProps` includes native button props, including `ref`, plus
  `appearance: "action" | "text"`. Render a real button, forward the props, and let text
  buttons wrap long subjects and filenames. The package adds no visual class to host controls.
- `EmailSelectProps` supplies `id`, `value`, `onValueChange`, and `options` (value/label pairs).
  Put `id` on the focusable trigger so its visible label remains associated. Keep the empty
  value for the “All” option. The app owns keyboard and focus behavior in its replacement.

The monitor supplies labels, selection, pagination, reader focus, and close-to-opener focus.
Host controls must preserve those behaviors. Base UI can supply accessible controls, but the
package does not require it. See the Mail app for a Button adapter.

## Behavior

- Opening a message does not mark it as read or change any stored record.
- No compose, resend, delete, or inbox-management actions are included.
- Accepted means Cloudflare accepted the message, not that all recipients received it. Details
  show the provider's recorded recipient outcomes. Unknown delivery has no resend action.
- Only plain text is rendered. Email HTML and remote images never enter the app document.
- The table loads message metadata. Bodies, attachments, and delivery details load only for the
  selected message. Queries update through Convex subscriptions, without polling.
- Exclude the whole monitor from session recordings, not only its text. Message subjects also
  appear in accessibility attributes. Keep mail content out of analytics and error reports.

The backend component and UI package are Apache-2.0 licensed.
