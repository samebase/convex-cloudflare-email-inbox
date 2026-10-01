# Shared email component design and OpenSend review

Updated October 1, 2026. This is a working design note for cross-agent review, not a release announcement.

## Direction

The goal is one reusable Cloudflare email implementation for Samebase apps. Mail is the first inbox
consumer, and Samebase is the first notification consumer. Both use the same package. Improvements
to sending, message history, and failure handling belong in that package rather than app-specific transports.

The repository is `samebase/convex-cloudflare-email-inbox`. Its package is
`@samebase/convex-cloudflare-email-inbox`, under `packages/convex-cloudflare-email-inbox`. The private
Mail reference app lives in `apps/mail` and also provides a starting point for other mail apps.
The root owns shared tooling, workspace commands, and documentation. Extracting a package does not
require making the repository public.

The app depends on the component through `workspace:*`. Other repositories install the published
package. Folder names do not change its import name or the installed Convex component name `mail`.
Cloudflare builds stay rooted at the repository and delegate to app scripts in `apps/mail`.

An inbox is a sending identity with communication history. Receiving is optional. A notification
inbox is valid even if nobody routes incoming messages to it. We keep the unified inbox → thread →
message model so an app can later receive replies without moving sent history into another model.

## What OpenSend actually provides

I inspected [opensend.cc](https://opensend.cc/docs), its documentation, and the source at commit
[`db16b71`](https://github.com/PanaraStudios/opensend.cc/tree/db16b71fd76998df17f52d016371c2c04610ff22).
I did not run its application, tests, or live AWS delivery. Claims below describe inspected code,
not verified production behavior.

OpenSend is a self-hosted Resend-style platform. Next.js provides its dashboard, Convex stores data
and runs jobs, and AWS SES sends mail. Incoming mail passes through temporary S3 storage into
Convex File Storage. Its SDK connects to an installation's Convex HTTP API, not a shared hosted origin.
See its [architecture documentation](https://opensend.cc/docs).

I found no packaged reusable email Convex component in that revision. Its
[component configuration](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/convex/convex.config.ts)
installs Workflow, Workpool, rate limiting, aggregates, migrations, and a local Better Auth component.
The email engine is app-level Convex code. The published
[`@opensendcc/sdk`](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/packages/sdk/package.json)
is an HTTP client, not a component you install with `app.use`.

Its actual email code is more complete than its README's older demo descriptions suggest. There are
real SES calls, durable send jobs, incoming-message parsing, recipient events, suppressions,
scheduled sends, and attachment storage. The dashboard's email queries read Convex. That makes it a
useful design reference, but code breadth alone does not establish operational reliability.

## Findings that affect our design

| OpenSend choice                                                       | Our decision                                                                  | Reason                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Send returns the stored email ID; detail retrieval uses that ID       | Return our local `messageId` from `EmailInbox.send`, alongside delivery state | Callers need to find retained history without confusing local IDs with provider IDs                  |
| Metadata, content, events, and recipient history have separate tables | Keep our separate message, body, and attachment records                       | Thread lists do not need bodies; conversation message pages deliberately load their displayed bodies |
| Dashboard, API, SMTP, and system sends use a common creation function | Keep `mail.queueSend` as the common write boundary for `send` and `enqueue`   | Every caller gets history and request deduplication                                                  |
| Idempotency keys reject different request content                     | Keep our normalized stored-payload comparison                                 | The current Convex client does not need a separate HTTP request-reservation table                    |
| Recipient-specific delivery events                                    | Preserve Cloudflare's recipient-result groups                                 | Provider acceptance is not proof that every recipient received the message                           |
| A single latest-event status with generation and claim fields         | Keep our discriminated delivery state                                         | We do not yet need scheduled edits, cancellation, or resend generations                              |
| Explicit throttling and server failures can retry                     | Keep one Cloudflare provider attempt and an explicit `unknown` state          | A server error or missing receipt can still follow provider acceptance                               |
| Sent and received emails have separate models                         | Keep unified inboxes and threads                                              | Our product is private multi-inbox mail with replies, not primarily a sending dashboard              |
| Email content expires after 30 days                                   | Keep history until explicit operator deletion                                 | Communication history is an accepted requirement for our apps                                        |

The relevant upstream sources are its
[send SDK](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/packages/sdk/src/emails/emails.ts),
[email tables](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/convex/tables/emails.ts),
[common creation and delivery recording](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/convex/emails.ts),
[HTTP idempotency checks](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/convex/api/state.ts),
[delivery action](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/convex/emailSend.ts), and
[recipient-event projection](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/convex/ses/projection.ts).

OpenSend's HTTP send response means queued, not delivered. We must not copy that meaning into
Samebase's synchronous feedback flow, which currently waits for a provider receipt. See its
[sending guide](https://opensend.cc/docs/dashboard/emails/sending).

## Developer interface

`new EmailInbox(components.mail, { defaultInbox })` configures a default sending identity.
The default inbox is created idempotently. An explicit `inboxId` selects an existing identity.

`send(ctx, options)` runs from an action. It records the message, claims one provider attempt, and
returns `{ messageId, ...deliveryState }`. `messageId` identifies the stored component message.
An accepted result also contains Cloudflare's separate `providerMessageId` and recipient results.

`enqueue(ctx, options)` runs from a mutation. It records the message and schedules sending in the
same transaction, then returns `messageId`. Queue acceptance does not mean provider acceptance.

Both calls require a stable `clientRequestId`. A repeated identical request returns the original
record. A repeated ID with different normalized content fails. An in-flight replay can return
`sending`; it does not start another provider call or promise to wait for the first caller.

The component stores `queued`, `sending`, `accepted`, `rejected`, and `unknown` delivery states.
Accepted results retain `delivered`, `queued`, `permanent_bounces`, and `suppressed_recipients`.
Applications interpret those groups for their own notification requirements.

A watchdog marks interrupted attempts `unknown`. A late conclusive receipt can still settle an
unknown record to accepted or rejected. Unknown records are never automatically resent. The SDK
has retries disabled because Cloudflare does not document provider-side idempotency for sending.

Trusted app functions read history through the component's inbox, thread, message, and delivery
queries. The package does not expose a public HTTP API or decide who may read another user's mail.
An app owns authorization for any public wrappers.

## Dashboard ideas worth keeping

OpenSend's [message detail view](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/components/dashboard/emails/detail.tsx)
puts message identity, recipients, content, and delivery diagnostics together. Its
[list view](https://github.com/PanaraStudios/opensend.cc/blob/db16b71fd76998df17f52d016371c2c04610ff22/components/dashboard/emails/lists.tsx)
supports search and status filters without fetching every body. I inspected these implementations,
not a running dashboard.

For Mail, the useful follow-up is a message-details section with the local ID, provider ID, failure
reason, and each recipient-result group. A real delivery-event timeline can follow when Cloudflare
provides events that we can authenticate and reliably correlate. We should not invent opened,
clicked, or delivered events from request acceptance.

Public sharing, campaign tools, template conversion, and tracking do not serve the current private
inbox and notification use cases. They are outside this integration.

## Ownership and storage

The component owns inbox and message records, request deduplication, delivery state, and Cloudflare
transport. Apps own message composition, recipient selection, access control, and retention policy.

Samebase's sending-only integration uses `notifications@samebase.com`. It does not add a Worker or
R2 bucket. Mail retains its inbound email Worker and R2 storage for complete `.eml` files and named
attachments. Inbound routing and object signing remain app-owned.

The official Cloudflare SDK is an internal dependency. A separate generic Cloudflare API package
is deferred until another real consumer establishes what that package should own. The selective
SDK imports work in Convex's default runtime, so outbound mail does not require a Node action.

Existing component data must remain under the installed name `mail`, with unchanged table names
and indexes. New receipt fields are optional for older rows. Extraction is not a fresh database.

## Current implementation and verification

The package extraction, Cloudflare sender, Mail migration, and locally linked Samebase integration
are implemented in working branches. They are not a published or deployed release.

The monorepo build passed, including formatting, lint, type checks, and 60 workspace tests. A fresh packed
consumer also passed strict type checks and a mocked send through the package exports without the
authoring workspace's dependency patch. Samebase's focused notification tests and full application
type check passed. A local Convex backend accepted the component and its history queries.
After the directory move, the packed consumer and Samebase type check passed again. The Worker
deployment dry run resolved Mail's assets and bindings from `apps/mail` and uploaded nothing.

Those checks do not prove live delivery. No real Cloudflare send or production deployment ran in
this integration. The message-ID refinement passed a fresh packed-consumer check, including retained
history lookup and identical-request replay. Samebase's full application type check also passed
against the refined client.

The package's npm login is currently unauthorized. Samebase uses a temporary absolute local link
for development. That link must not be committed. A portable release dependency and lockfile remain
required before the Samebase integration can ship.

## Remaining work and release conditions

1. Checkpoint and review the package and Mail changes in the existing extraction PR.
2. Resolve npm publishing access and publish the reviewed package version. Replace Samebase's
   temporary link with that exact version and regenerate its lockfile.
3. Finish the Samebase integration PR, keeping signup, feedback, and deletion behavior unchanged
   apart from the shared transport and retained history.
4. Before Mail cutover, drain old scheduled sends and confirm the new sending credentials are set.
   Pending jobs targeting the deleted host action cannot execute after that action disappears.
5. Verify a controlled live send and history receipt before claiming operational completion.

The production Cloudflare build command is already held pending the extraction PR. Keep that hold
until the reviewed rollout is ready. Do not deploy the old app schema over component data.
The local development and cutover details are in [the integration guide](./integration.md).

## Questions for reviewers

These questions invite review. They are not blockers that require the owner to answer first.

- Does `send` returning a local ID alongside its delivery discriminant give callers enough history
  access, or does the first real consumer justify a small client retrieval method?
- Is every producer using `mail.queueSend`, with no app-specific direct-provider path left behind?
- Do concurrent replay, provider ambiguity, watchdog expiry, and late receipts all preserve the
  one-attempt contract?
- Do the component move and rollout preserve existing data and avoid stranded scheduled jobs?
- Can Samebase's trusted operators inspect retained notification history without adding a public
  mail endpoint? Does the documented retention exception match the implemented account scrub?
- Is anything in the package coupled to Mail's Worker or R2 when it should be optional for a
  sending-only app?

The most useful feedback names a real caller, a failure sequence, or a data migration risk. Adding
an abstraction only because OpenSend has one would not improve this component.
