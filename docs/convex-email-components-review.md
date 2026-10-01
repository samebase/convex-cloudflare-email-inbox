# Convex email components: competitive and implementation review

Research snapshot: October 1, 2026. This is a source review and a recommendation, not a release
announcement or a production reliability certification.

October 2 follow-up: the API and receiving changes recommended here are now implemented locally.
See [implementation and verification](./email-api-implementation.md). Statements about our missing
features below describe the pinned October 1 source, not the updated working tree.

## Conclusion

There is a useful reason to publish this component, but **another Cloudflare sending queue is not
that reason**. Two existing components already provide Cloudflare sending, durable queueing,
deduplication, diagnostics, and richer outgoing messages than our current API. One already handles
uncertain sends explicitly rather than automatically retrying them.

Our defensible contribution is this combination:

> Cloudflare-backed sending and receiving, with multiple inboxes and unified conversation history
> stored in Convex, plus raw mail and named attachments in your own R2 bucket.

None of the reusable components inspected here offers that complete combination. This is a finding
about this audit's scope, not a claim to be the first or only such project anywhere. AgentMail and
convex-inbound already offer receiving, so “an inbox for Convex” alone is not a differentiator.

The current repository has much of that combination, but the **package boundary does not
yet include the full receiving integration**. The Worker lives in the reference app, and the main
client class exposes sending rather than a complete inbox interface. We should fix that mismatch
before presenting the package as a turnkey inbox component.

Keep `samebase/convex-cloudflare-email-inbox` and
`@samebase/convex-cloudflare-email-inbox`. The suffix distinguishes it from existing senders and
describes the actual reason to choose it. A suitable directory title is “Cloudflare Email Inbox,”
with sending and receiving stated in the description.

## Scope and evidence

I checked every one of the 17 results in the supplied screenshot against the live directory, then
included Lettermint and three related notification/invitation components from the directory's
machine-readable catalog. That is **21 packages: 14 email delivery/queue integrations and seven
adjacent tools**. Registry and web searches did not reveal another purpose-built component to add
to this set. That is not an exhaustive claim about unpublished or unindexed projects.

For each package I inspected its public repository, component schema, app-facing interface, and
relevant delivery, ingress, webhook, or lifecycle implementation. The five closest alternatives
received more detailed failure-path review. I also inspected test files, but **did not run upstream
test suites, deploy those components, or send real email**. Security and retry concerns below are
source-level findings, not reproduced production incidents.

The [version and commit inventory](./research/convex-email-components-2026-10-01.json) records npm
versions, publication dates, declared licenses, npm `gitHead`, and inspected repository commits.
Repository HEAD sometimes differs from the published version. Findings describe the pinned source,
not a claim that every finding also exists in the npm tarball. No upstream application code was
copied into our implementation.

The [inventory script](../scripts/research-email-components.ts) can refresh registry metadata,
directory pages, and shallow source snapshots without installing or running upstream packages:

```sh
node scripts/research-email-components.ts
```

It prints a temporary snapshot directory and reports missing catalog entries or fetch failures.
The checked-in JSON preserves the reviewed snapshot; rerunning the script does not overwrite it.
Publication timestamps in the checked-in snapshot were also read from npm's package history.

Directory descriptions alone were not sufficient. The live UI and machine-readable catalog had
different total counts; Email SDK's description understates its current durable component, and
some “threading” descriptions do not correspond to locally stored thread tables. The audit uses
source for those distinctions. [Directory catalog](https://www.convex.dev/components/llms.txt)

Research verification: all 21 source snapshots were fetched, all 43 pinned source links were checked
against those snapshots, and local document links resolved. This repository's `pnpm run check`
passed, including 60 tests. Those checks do not validate upstream components or live mail delivery.

## Complete inventory

Versions below are npm's latest tags at research time. Source links point to the inspected commit.
“No inbox” means no received-email mailbox/conversation model in that component, not that its
underlying provider could never receive mail.

| Directory entry                      | Package and version                       | Actual role                                                  | Relevance to us                                                      |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Resend][resend]                     | `@convex-dev/resend@0.2.8`                | Durable outbound Resend integration                          | Strong queue, batching, idempotency, and webhook reference; no inbox |
| [Loops][loops]                       | `@devwithbobby/loops@0.2.0`               | Contacts, events, and transactional templates on Loops       | Marketing-provider integration, not a mailbox engine                 |
| [Cloudflare Email Sending][ezy]      | `@ezyyeah/cloudflare-email-sending@0.1.0` | Cloudflare sender with stored content, attempts, and retries | Direct overlap with outbound half                                    |
| [Agentmail][agentmail]               | `@agentmail/convex@0.1.0`                 | AgentMail inbox integration and local webhook data           | Closest functional competitor; hosted provider owns mailbox service  |
| [Sweego][sweego]                     | `@christian-ek/sweego@0.4.1`              | Email/SMS queue and recipient delivery tracking              | Useful recipient-level schema; no email inbox                        |
| [convex-inbound][inbound]            | `@hamzasaleemorg/convex-inbound@0.1.6`    | Send/receive/reply through inbound.new                       | Competes on receiving, but different provider and data model         |
| [Email Queue][email-queue]           | `@vllnt/convex-email@0.1.0`               | Transport-neutral queue state plus SMTP/JMAP helpers         | Host owns dispatch and recovery; no received-mail engine             |
| [Convex Invite-links][invite-links]  | `convex-invite-links@1.0.0`               | Resource membership and claimable invitation links           | Email is an audience constraint, not mail transport                  |
| [useSend][usesend]                   | `@pulgueta/usesend-convex@0.3.0`          | Durable sending through hosted/self-hosted useSend           | Useful event-race handling; separate mail platform                   |
| [Suppression List][suppression]      | `@vllnt/convex-suppression@0.1.0`         | Contact suppression and opt-in evidence                      | Potential future companion, not a replacement                        |
| [Email SDK][opencore]                | `@opencoredev/convex-email@4.0.0`         | Durable multi-provider sender, including Cloudflare          | Broader outbound alternative; no received inboxes                    |
| [Invite][invite]                     | `convex-invite@0.1.1`                     | Invitation lifecycle and host-supplied delivery adapter      | Uses email transport; does not replace it                            |
| [Brevo][brevo]                       | `convex-brevo@0.0.2`                      | Queued email/SMS through Brevo                               | Provider-specific outbound integration                               |
| [treg][treg]                         | `@listeningkit/treg@0.1.4`                | Metered external-tool gateway                                | Email tools are incidental; no mailbox model                         |
| [AWS SES][ses]                       | `convex-aws-ses@1.0.1`                    | SES sending with SNS event ingestion                         | Different infrastructure; no received-email storage                  |
| [AutoSend][autosend]                 | `@autosend/convex@0.4.1`                  | Queue, templates, contacts, and delivery events              | Broad outbound provider integration                                  |
| [Cloudflare Email Sender][adam]      | `convex-cloudflare-email@0.1.0-beta.0`    | Transactional Cloudflare sender with explicit uncertainty    | Closest outbound benchmark                                           |
| [Lettermint][lettermint]             | `convex-lettermint@1.0.1`                 | Queued Lettermint sending and signed events                  | Additional sender missed by live email-search results                |
| [Notifications Inbox][notifications] | `@vllnt/convex-notifications@0.1.0`       | Persistent in-app alerts and read state                      | “Inbox” means app notifications, not email                           |
| [Notification][notification]         | `convex-notification@0.1.1`               | Notification batches, counters, and host hooks               | Adjacent app-state component, no email transport                     |
| [Invitations][invitations]           | `@vllnt/convex-invitations@0.1.0`         | Token-based invitation lifecycle                             | Sending and membership remain host responsibilities                  |

OpenSend remains covered by the [earlier pinned-source review](./email-component-design.md). That
review found an application-level email platform, not an installable reusable email component in
the inspected revision, so it is not counted among these 21 packages. I did not repeat a full
OpenSend application audit during this comparison.

## The closest alternatives

### Cloudflare Email Sender: the outbound benchmark

Adamtrip's component already enqueues from a mutation, uses Workpool with bounded concurrency,
supports HTML, Bcc, Reply-To, headers, and inline/file attachments, and records Cloudflare's
recipient groups. An identical idempotency key and payload returns the existing record; a different
payload under that key is rejected. It supports pending cancellation, test mode, explicit retry,
and terminal-record cleanup. [Schema and API][adam] · [Enqueue/retry implementation][adam-lib]

Its failure model is particularly relevant. An HTTP 429 has a bounded retry path honoring
`Retry-After`. Network errors, HTTP 408, server errors, and unusable success receipts become
`unknown`. Retrying an unknown message requires acknowledging duplicate risk. There is one HTTP
attempt per claimed send, with a timeout and a watchdog for interrupted work.
[Transport][adam-transport] · [Send action][adam-send]

Therefore, safe uncertainty handling, transactional queueing, and payload-checked deduplication are
**not unique to our package**. Its outgoing message interface is currently more capable than ours.
It has no received-email ingestion, mailbox/thread model, or R2 raw-mail handling.

This is the first implementation to evaluate if we later decide to outsource our outbound queue.
It is not a drop-in replacement: its queue would need to stay consistent with our message history,
and our synchronous `send` callers need a provider receipt rather than only a queued ID.

### Cloudflare Email Sending: richer content and attempt records

Ezyyeah separates email metadata, content references, and attempt records. HTML, text, and
attachments use Convex storage; the sender supports Cc/Bcc, Reply-To, headers, inline attachments,
payload fingerprints, and retry diagnostics. Its client send path is action-based, including
content storage, rather than our mutation-first transactional enqueue interface.
[Schema][ezy-schema] · [Actions][ezy-actions]

It has a reconciliation state for interrupted sending or failures recording a provider receipt.
However, its transport classifies network exceptions and HTTP 5xx as retryable, and malformed 2xx
responses as non-retryable failures. The normalized acceptance object retains delivered, queued,
and permanent-bounce recipients, but not the current API's message ID and suppressed-recipient
group. The raw response is also available internally. [Provider][ezy-provider] · [State transitions][ezy-mutations]

Inference: retrying after a lost receipt can resend an email Cloudflare already accepted. A local
payload fingerprint prevents duplicate enqueueing; it does not make a second external send safe.
We should borrow the separation of content and attempt diagnostics, not copy that retry policy
without a provider guarantee. This component has no receiving or conversation model.

### AgentMail: the strongest inbox API reference

AgentMail exposes inbox creation, sending, replying, forwarding, remote thread/message retrieval,
and receive/event hooks. Svix verification protects webhook ingestion; webhook event IDs deduplicate
processing. Separate pools handle sending and callbacks. This is substantially more complete as an
app-facing inbox interface than our current client class. [Client][agentmail-client] · [Webhook verification][agentmail-webhook]

Its local schema stores inboxes, inbound messages, outbound messages, and webhook events. Inbound
messages include text/HTML, extracted content, provider thread IDs, and raw event data. But there is
no local `threads` table: `listThreads`, `getThread`, and `getMessage` call AgentMail's service.
Local inbound listing can filter by inbox/thread ID. Finalized outbound records have a seven-day
default cleanup window. [Schema][agentmail-schema] · [Implementation][agentmail-lib]

Our difference is not “AgentMail keeps everything remote.” It already projects useful mail data
into Convex. The difference is a direct Cloudflare deployment with locally authoritative unified
conversation history and raw MIME/attachments under our R2 policy, without an AgentMail service
account. Conversely, AgentMail provides the managed mailbox service and richer API that we must
operate and finish ourselves.

Its receive hooks and separation of callback work from durable ingestion are worth following.
Do not require an AI agent to use our component just because this competitor targets agents.

### convex-inbound: receiving exists, but not the same schema

This integrates with inbound.new. Its schema separates `inbound_emails`, `outbound_emails`, and
`delivery_events`; inbound records include text/HTML, attachment metadata and download URLs, and
message IDs. Received-message insertion deduplicates by message ID. The API supports sending,
receiving, and replies. [Schema][inbound-schema] · [Client][inbound-client]

There are no persistent inbox or thread tables. Reply support sets `In-Reply-To` and `References`;
that is useful, but different from a queryable local conversation model. Sending uses Workpool,
batching, and rate limiting. The code puts an `Idempotency-Key` in message headers; that should not
be assumed to be provider-enforced HTTP request idempotency. [Delivery and ingestion][inbound-lib]

Webhook authentication is optional: configuring a secret checks `X-Webhook-Secret`, while the
unconfigured path accepts the request. That convenience is not a default we should copy. Our
receiving adapter should reject requests when authentication is missing or invalid.
[Webhook registration][inbound-client]

This is a real alternative when choosing inbound.new, but it neither supplies a Cloudflare/R2
deployment nor removes the need for our multi-inbox conversation model.

### Email SDK: a real component, not just a thin wrapper

OpenCore's current `@opencoredev/convex-email` contains a durable Convex queue. It has email,
event, webhook-delivery, and configuration tables; transactional enqueueing; scheduled sends;
processing leases; retries and stale-work recovery; cancellation; owner-scoped wrappers; and
multi-provider fallback. The send worker runs in a Node action. The directory's generic SDK
description does not capture this scope. [Component schema][opencore-schema] · [Client][opencore-client] · [Worker][opencore-worker]

It supports many providers, including Cloudflare, and a richer message shape than ours. Webhook
registration requires a verifier by default unless explicitly overridden. Its webhook support
concerns delivery events, not received-message inboxes. There are no mailbox/thread tables.

Two Cloudflare-specific limitations matter:

- The HTTP adapter normalizes delivered and queued recipients into one accepted array. It does not
  populate the normalized provider ID from `message_id`, or retain suppressed recipients there.
  The raw response exists at SDK level, but the Convex worker stores only the normalized result.
  This loses distinctions our Samebase notification caller currently uses.
  [Cloudflare adapter][opencore-cloudflare] · [Stored send result][opencore-worker]
- Stale-processing recovery retries when a local `idempotencyKey` exists. The SDK's own capability
  map does not mark Cloudflare as supporting native idempotency. Inference: a crash after provider
  acceptance but before local completion can lead to a duplicate on recovery. The fallback setting
  that stops on unknown delivery does not itself prove this separate recovery path safe.
  [Recovery][opencore-lib] · [Provider capabilities][opencore-capabilities]

This is the strongest candidate if multi-provider delivery becomes a requirement. It is not the
smallest fit for our current Cloudflare-only inbox, and adopting it would still leave the receiving
engine and conversation schema to us. Verifier-required routes, owner-scoped wrappers, and explicit
event history are useful design references independent of adoption.

## The other nine email integrations

### Resend

The official component is a strong reference for durable outbound delivery: queueing, batching,
rate limits, Workpool, cancellation, status retrieval, delivery events, callbacks, and signed
webhooks. Message content is separate from lightweight email records. Crucially, its batch sender
uses Resend's HTTP idempotency header. That provider support changes which retry strategies are
safe; copying the surrounding queue does not give Cloudflare the same guarantee. There is no
received-mail inbox/thread schema. [Source][resend] · [Delivery implementation][resend-lib]

Useful lesson: separate provider acceptance from subsequent delivery events, keep list metadata
small, and tie retry policy to an actual provider contract. “Uses Workpool” is not an exactly-once
delivery guarantee.

### Loops

Loops focuses on contacts, subscriptions, contact events, and provider-hosted transactional
templates. Its tables store contact state and operation records. Transactional sends call Loops
directly from an action and log the outcome, rather than providing a received-email or conversation
engine. The API is naturally centered on a transactional template ID and variables.
[Source, schema, and client][loops]

It is useful when Loops is the chosen marketing/contact system. It contributes no reason to add
marketing contacts, campaign primitives, or provider-template IDs to our mailbox component.

### Sweego

Sweego provides email and SMS delivery, templates/bulk operations, and a particularly useful
recipient-level model. `messages`, `deliveries`, and `deliveryEvents` distinguish a send from each
recipient's outcome. Delivery webhooks use HMAC verification with timestamp checks and event
deduplication. The schema also supports administrative listing/search. There is no received-email
mailbox model. Content is stored in component documents, so its storage approach is not a substitute
for large raw MIME files. [Schema and implementation][sweego]

Useful lesson: when later adding authenticated delivery events, model recipient state separately
from the submission's aggregate state. One recipient's bounce must not erase another's success.

### Email Queue

This is genuinely transport-neutral. It stores opaque payloads, envelope addresses, a transport
name, attempt counts, provider ID, subject reference, and status. The host claims work and calls
`markSent` or `markFailed`; the component does not dispatch providers itself. SMTP and JMAP helper
modules are provided, but host scheduling, credentials, failure interpretation, and recovery remain
integration work. The built-in cron prunes terminal records. [Schema, client, and transport helpers][email-queue]

Duplicate keys return existing queue entries, but that is enqueue deduplication rather than a
promise about external delivery. There is no explicit unknown-delivery state or received-mail
history. Reusing it would replace some queue bookkeeping, not the difficult parts of our component.

### useSend

This is a durable sender for the hosted or self-hosted useSend platform. It has batching, rate
limits, actual HTTP idempotency headers, text/HTML content records, delivery events, and authenticated
webhook handling. `pendingEvents` buffers webhook events that arrive before the provider message
mapping is available. Outbound reply headers do not make it a received-mail inbox.
[Schema and delivery implementation][usesend]

Useful lesson: provider callbacks can race local send completion. Buffering unmatched events is
worth considering if Cloudflare later supplies a delivery-event channel we integrate. Choosing
useSend would also mean choosing another mail platform, not merely installing an inbox component.

### Brevo

Brevo integrates queued email and SMS, provider templates, parameters/tags, and event tracking. Its
schema separates content and delivery records. The inspected webhook wrapper requires a configured
secret and accepts it through a query token or header; this is a shared-secret check, not the same
mechanism as a provider-signed payload. SMS reply events do not imply email inbox support.
[Schema, client, and delivery implementation][brevo]

This is useful for Brevo users, not a Cloudflare building block. We should keep provider-specific
template/contact concepts outside our core message model unless a real caller needs them.

### AWS SES

The component uses SESv2 for outbound delivery and handles SNS notifications. It is not a receive
pipeline that stores SES inbound messages from S3. Its batch action sends entries sequentially and
records the successes after processing; a later retryable error can interrupt before those earlier
successes are recorded. Inference: replaying that batch can repeat already accepted sends.
[Batch sender][ses-lib]

The inspected SNS handler also parses notifications and follows subscription confirmation URLs
without showing signature verification in that method. A public integration needs authenticated
SNS handling and topic restrictions elsewhere; we should not assume the helper alone supplies them.
These are source-review cautions, not evidence of an exploited deployment. No reason emerged to
switch our Cloudflare infrastructure to SES for this component.

### AutoSend

AutoSend includes durable sending, local idempotency, templates, attachments, contacts/projects,
attempt tracking, webhook deduplication, and event history. Its sender has an explicit timeout;
transient failures can be retried. Webhooks require a secret and verify a signature and timestamp.
Configuration can persist provider credentials in a component table, a design choice we do not
need when our transport reads environment secrets at attempt time. There are no received-email
inbox/thread tables. [Schema and implementation][autosend]

Useful lesson: delivery diagnostics and authenticated events are expected features in this category.
Its contact/template breadth is provider integration work, not a reason to widen our MVP.

### Lettermint

Lettermint is another queued transactional sender, with separate content, delivery state, provider
routing/tags/metadata, and timestamped HMAC webhook verification. It is listed in the catalog even
though it was absent from the live email-search result set inspected here. It has no local
received-message inbox/thread model. [Source and schema][lettermint]

It reinforces that durable outbound mail with status/event tracking is an established component
category. Those features alone are not enough to distinguish our listing.

## Seven adjacent components, not competing mailbox engines

| Component                            | Inspected model and boundary                                                                                                                     | Decision                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [Suppression List][suppression]      | Hashed-contact suppressions by channel/reason, opt-in proof, eligibility queries. It does not automatically intercept another component's sends. | Consider composing it if unsubscribe/consent policy becomes a requirement. Do not rebuild it preemptively. |
| [Convex Invite-links][invite-links]  | Members, resource access, token claims, expiration, recipient restrictions.                                                                      | App-level access workflow; send invitations through our normal sender.                                     |
| [Invite][invite]                     | Invitation lifecycle, hashed tokens, deduplication, delivery bookkeeping, host-supplied delivery adapter.                                        | Potential caller of our component, not a replacement.                                                      |
| [treg][treg]                         | External tool calls, owner references, endpoints, and cost records.                                                                              | General gateway; email relevance is incidental. No reason to route our Cloudflare traffic through it.      |
| [Notifications Inbox][notifications] | Notification payloads and read state indexed by subject.                                                                                         | In-app alerts, not RFC email. Per-user read state is a useful reminder for future shared-mailbox design.   |
| [Notification][notification]         | Notifications, batches, seen/dismissed counters, deduplication, host hooks.                                                                      | Another in-app notification implementation; transport remains host-owned.                                  |
| [Invitations][invitations]           | Hashed invitation tokens, expiration, resource references, lifecycle transitions.                                                                | Host owns email sending and membership effects. Keep those concerns separate.                              |

## What our implementation actually provides

Reviewed our source at `7b67dfc44f725c79757bd083404bbe78a8052ce6`, before this research-only change.

| Capability                            | Current location/state                                                         | Assessment                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Multiple sending/receiving identities | Component domain and inbox tables                                              | Real model, but creating an inbox does not provision Cloudflare DNS/routing                     |
| Unified sent/received history         | Component threads, messages, bodies, and attachments                           | Main structural difference from sender-only components                                          |
| Reply correlation                     | Inbox-scoped RFC message ID/reference matching                                 | Useful; provider IDs and RFC IDs must remain distinct                                           |
| Durable send intent                   | `enqueue` schedules in a mutation; `send` records then attempts delivery       | Real, but not unique                                                                            |
| Duplicate request protection          | Stable client request ID plus normalized payload comparison                    | Real, but also implemented by both direct Cloudflare competitors                                |
| Ambiguous send handling               | One provider attempt; unknown state; watchdog; late receipt can settle unknown | Valuable safety property, not a unique feature                                                  |
| Full Cloudflare acceptance receipt    | Provider message ID and all four recipient groups                              | Important to our notification caller; no later event timeline yet                               |
| Rich outgoing messages                | Plain text, To/Cc, sender name, reply references                               | Behind competitors: no HTML, Bcc, custom Reply-To, or outgoing attachments                      |
| Raw mail and named attachments        | Mail Worker writes R2; component stores object metadata                        | Works across the repository, not yet a complete installable receiving adapter                   |
| Inbound deduplication                 | Reservation plus raw-message digest; transactional finalization                | Useful foundation; interrupted cross-service work still needs a demonstrated recovery path      |
| Inbox developer interface             | Component functions exist; main client exposes `send`/`enqueue`                | Behind AgentMail's inbox/reply/hook ergonomics                                                  |
| Access control                        | Trusted app wrappers                                                           | Host must authorize reads and writes; component isolation is not per-user mailbox authorization |
| Retention                             | History retained rather than auto-expired                                      | Fits our requirement; deletion/export and raw-object cleanup need an explicit contract          |

Sources: [component schema](../packages/convex-cloudflare-email-inbox/src/component/schema.ts),
[client](../packages/convex-cloudflare-email-inbox/src/client/index.ts),
[send state](../packages/convex-cloudflare-email-inbox/src/component/mail.ts),
[Cloudflare transport](../packages/convex-cloudflare-email-inbox/src/component/cloudflareEmail.ts),
[ingestion](../packages/convex-cloudflare-email-inbox/src/component/ingress.ts), and
[receiving Worker, now extracted into the package](../packages/convex-cloudflare-email-inbox/src/worker/index.ts).

There are several limits we should state plainly:

- Our current transport treats all HTTP 4xx responses as rejected, including 408 and 429. The
  Adamtrip implementation makes a more useful distinction. Review 408 as potentially ambiguous and
  add bounded retries only for a verified rejection such as throttling, not all transient errors.
- There is no general concurrency/rate-control layer, pending-send cancellation, or authenticated
  post-send delivery-event stream in the current component.
- Shared inbox unread counters are not per-person unread state. Multi-inbox support is not a claim
  of a finished multi-tenant mail product.
- R2 and Convex cannot participate in one transaction. Stable object keys and ingress deduplication
  help replay, but do not themselves prove recovery after every partial upload/finalization failure.
- Receiving has no equivalent of AgentMail's convenient `onMessageReceived` app hook yet. A hook
  must not make durable mail acceptance depend on arbitrary application work succeeding.

The current [Cloudflare send API](https://developers.cloudflare.com/api/resources/email_sending/methods/send/)
documents a provider message ID and separate delivered, queued, permanent-bounce, and suppressed
recipient groups. It does not document a request-idempotency parameter on that endpoint. Until a
provider contract establishes otherwise, a timeout after sending must be allowed to mean “we do
not know,” not “safe to retry.” None of these components can infer recipient receipt from local
queue acceptance.

## Build, adopt, or compose?

| Option                                                   | What it saves                                                            | What it changes or leaves unsolved                                                      | Recommendation                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Adopt AgentMail                                          | Mailbox service, rich inbox API, provider thread retrieval, hooks        | Adds AgentMail dependency; different storage/control model                              | Best alternative if managed mailbox convenience takes priority over direct Cloudflare/R2                  |
| Adopt convex-inbound                                     | Hosted receiving/sending integration                                     | Adds inbound.new; still needs our local mailbox/thread model                            | Valid provider choice, not the requested infrastructure                                                   |
| Compose Adamtrip sender with our inbox engine            | Rich payloads, bounded sender queue, explicit uncertainty/retry controls | Two durable record lifecycles to synchronize; direct receipt semantics need design      | Worth a small integration experiment if maintaining the sender becomes costly; not an automatic migration |
| Adopt OpenCore Email SDK                                 | Broad provider coverage, queue/recovery/events, rich messages            | Still needs receiving; Node worker; Cloudflare receipt/recovery concerns need resolving | Revisit only for a demonstrated multi-provider need                                                       |
| Keep our narrow transport and complete the inbox package | Preserves one message history and our existing callers                   | We own missing payload features, ingress packaging, and operational tests               | Best fit for the agreed Cloudflare-only scope today                                                       |

The recommendation to keep our component is conditional on finishing the inbox contribution. If we
were building only transactional sending, using or improving an existing Cloudflare sender would
be the better starting point. Existing code is not, by itself, a reason to maintain a duplicate.

“Your own infrastructure” should mean **your Cloudflare and Convex accounts**, not a claim that the
component runs a standalone SMTP server or replaces either managed platform. It does not promise
IMAP, spam filtering, domain provisioning, or a managed deliverability service.

## Focused next steps

These are proposed follow-ups, not implementation performed during this audit. They refine the
[existing design note](./email-component-design.md), not a new platform roadmap.

1. **Make receiving a supported package feature.** Provide a small reusable Worker/ingress adapter
   and documented R2 contract, or a deliberately minimal supported Worker example. Avoid copying a
   substantial Mail-specific ingestion implementation into every consumer. Keep R2 and the Worker
   optional for sending-only apps.
2. **Complete the inbox-facing interface.** Expose a coherent path for inbox creation, thread/message
   reads, replying, read state, and an authenticated receive hook. Keep app authorization outside the
   component and make that responsibility visible in examples. Do not add an agent or MCP layer.
3. **Close practical sending gaps.** Add HTML, outgoing attachments, Bcc, and Reply-To as needed by
   actual consumers, retaining one sent-message history. Study the existing Cloudflare senders for
   bounded throttling retries and payload limits before designing another queue abstraction.
4. **Verify the failure sequences that matter.** Cover lost provider receipts, 408/429 distinctions,
   watchdog/late-receipt races, same-key/different-payload requests, inbound replay, partial R2 writes,
   and reply correlation. Use a fresh consuming app, not just component internals.
5. **Publish with an accurate setup contract.** Prove a notification-only path and an
   inbox → receive → reply → history/attachment path. Then resolve npm access, review the source for
   public release, and submit an accurate listing. The directory requires a published npm package
   and public GitHub/GitLab source. Changing repository visibility is a separate authorized action.
   [Directory submission requirements](https://www.convex.dev/components)

Do not add a generic provider platform, campaign system, contact CRM, shared Cloudflare API package,
or agent runtime to justify the component. The useful addition is a reusable inbox that also serves
ordinary transactional-email callers.

## Questions for other reviewers

- Does keeping a narrow sender still cost less than bridging Adamtrip's durable queue into our
  message history and preserving the direct `send` contract? Show the integration boundary, not
  just a feature checklist.
- Can a new consumer receive and reply to mail without copying substantial reference-app code?
- Which state is authoritative after each R2 write, Convex mutation, provider send, and callback?
  Can a process stop between any two of those steps without silently losing mail or resending it?
- Does every exported public example enforce host authorization before exposing inbox history or
  attachment access? Are component-wide IDs ever accepted as proof of ownership?
- Does the proposed directory description describe the installed package, or features available only
  after deploying the whole Mail application?

[resend]: https://github.com/get-convex/resend/tree/66d5a1561b4d736d954b823e8d883192ccfea454
[resend-lib]: https://github.com/get-convex/resend/blob/66d5a1561b4d736d954b823e8d883192ccfea454/src/component/lib.ts
[loops]: https://github.com/robertalv/loops/tree/dc1f929b24852dfccacbfc0189be6b3548ecc7c1
[ezy]: https://github.com/ezyyeah/cloudflare-email-sending/tree/ecd56ba4e6da0cb528c44fb45c63bd8ada2fa3b7
[ezy-schema]: https://github.com/ezyyeah/cloudflare-email-sending/blob/ecd56ba4e6da0cb528c44fb45c63bd8ada2fa3b7/src/component/schema.ts
[ezy-provider]: https://github.com/ezyyeah/cloudflare-email-sending/blob/ecd56ba4e6da0cb528c44fb45c63bd8ada2fa3b7/src/component/provider.ts
[ezy-actions]: https://github.com/ezyyeah/cloudflare-email-sending/blob/ecd56ba4e6da0cb528c44fb45c63bd8ada2fa3b7/src/component/actions.ts
[ezy-mutations]: https://github.com/ezyyeah/cloudflare-email-sending/blob/ecd56ba4e6da0cb528c44fb45c63bd8ada2fa3b7/src/component/mutations.ts
[agentmail]: https://github.com/agentmail-to/convex/tree/46bde1a9132599760f425b55c9e29d5ba86ea7df
[agentmail-client]: https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/client/index.ts
[agentmail-webhook]: https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/client/webhook.ts
[agentmail-schema]: https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/component/schema.ts
[agentmail-lib]: https://github.com/agentmail-to/convex/blob/46bde1a9132599760f425b55c9e29d5ba86ea7df/src/component/lib.ts
[sweego]: https://github.com/christian-ek/sweego/tree/c8ad9fb508d8ff6f759d26b735c939037889355e
[inbound]: https://github.com/hamzasaleem2/convex-inbound/tree/42854b72db0458b20ace1ef71e72e43f9e28e607
[inbound-client]: https://github.com/hamzasaleem2/convex-inbound/blob/42854b72db0458b20ace1ef71e72e43f9e28e607/src/client/index.ts
[inbound-schema]: https://github.com/hamzasaleem2/convex-inbound/blob/42854b72db0458b20ace1ef71e72e43f9e28e607/src/component/schema.ts
[inbound-lib]: https://github.com/hamzasaleem2/convex-inbound/blob/42854b72db0458b20ace1ef71e72e43f9e28e607/src/component/lib.ts
[email-queue]: https://github.com/vllnt/convex-email/tree/904430f4615f8489ba57b8e6878c57bb020f8943
[invite-links]: https://github.com/TimpiaAI/convex-invite-links/tree/766fa0fb96e2215d5e8e805d310c21be8638e81b
[usesend]: https://github.com/pulgueta/usesend-convex/tree/07d1c9a81ab64c3e828f58ac875b700ddba71a01
[suppression]: https://github.com/vllnt/convex-suppression/tree/d5294fae01d9deec19c89ab99a2414a1b8ddf949
[opencore]: https://github.com/opencoredev/email-sdk/tree/6880ed62ca171336eeb18e1b398deb9bdd67d703
[opencore-schema]: https://github.com/opencoredev/email-sdk/blob/6880ed62ca171336eeb18e1b398deb9bdd67d703/packages/convex-email/src/component/schema.ts
[opencore-client]: https://github.com/opencoredev/email-sdk/blob/6880ed62ca171336eeb18e1b398deb9bdd67d703/packages/convex-email/src/client/index.ts
[opencore-worker]: https://github.com/opencoredev/email-sdk/blob/6880ed62ca171336eeb18e1b398deb9bdd67d703/packages/convex-email/src/component/worker.ts
[opencore-lib]: https://github.com/opencoredev/email-sdk/blob/6880ed62ca171336eeb18e1b398deb9bdd67d703/packages/convex-email/src/component/lib.ts
[opencore-cloudflare]: https://github.com/opencoredev/email-sdk/blob/6880ed62ca171336eeb18e1b398deb9bdd67d703/packages/email-sdk/src/cloudflare.ts
[opencore-capabilities]: https://github.com/opencoredev/email-sdk/blob/6880ed62ca171336eeb18e1b398deb9bdd67d703/packages/email-sdk/src/utils.ts
[invite]: https://github.com/dciccale/convex-invite/tree/fe5103072db3d8ee78d3be5776492ce9c1c22c7b
[brevo]: https://github.com/pierre-H/convex-brevo/tree/754bc2eed9c447a36e740f441cb130ac4d87a0c7
[treg]: https://github.com/matthewdonsemail-lab/convex-treg/tree/9896d556b30f3b832650624fb74481025c86e0eb
[ses]: https://github.com/orenaksakal/convex-aws-ses-emails-component/tree/1e344c9724cefc0f4fa4dd4d7cf52b7ed0f979af
[ses-lib]: https://github.com/orenaksakal/convex-aws-ses-emails-component/blob/1e344c9724cefc0f4fa4dd4d7cf52b7ed0f979af/src/component/lib.ts
[autosend]: https://github.com/autosendhq/autosend-convex/tree/82389cd47d11f9e21b08b6735fd0525022ded366
[adam]: https://github.com/adamtrip-solutions/convex-cloudflare-email/tree/0f73fec45c1e0fe18ca8530a6727631240658975
[adam-lib]: https://github.com/adamtrip-solutions/convex-cloudflare-email/blob/0f73fec45c1e0fe18ca8530a6727631240658975/src/component/lib.ts
[adam-transport]: https://github.com/adamtrip-solutions/convex-cloudflare-email/blob/0f73fec45c1e0fe18ca8530a6727631240658975/src/component/transport.ts
[adam-send]: https://github.com/adamtrip-solutions/convex-cloudflare-email/blob/0f73fec45c1e0fe18ca8530a6727631240658975/src/component/send.ts
[lettermint]: https://github.com/pierre-H/convex-lettermint/tree/5c729bbc5c543ed9e9cd4195e8d2acb7a31b4e95
[notifications]: https://github.com/vllnt/convex-notifications/tree/574a29f2bda9d07a0f016c1edb38154b2a3e38e0
[notification]: https://github.com/ben-katz/convex-notification/tree/7db3c9cf993fcefcf9b21828533e1a5ceb8d7598
[invitations]: https://github.com/vllnt/convex-invitations/tree/ebbf6c481acc35f08cacb9207c0daad986426054
