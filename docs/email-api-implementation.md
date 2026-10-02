# Email API implementation

Approved scope, October 2, 2026. Convex remains the authoritative inbox and delivery history.
R2 retains raw mail and named attachments. This work does not publish the npm package or deploy to production.

- [x] Ground: inspect current delivery, ingress, Mail, and Samebase call sites.
- [x] Sketch: compare two small designs for the public API and receiving boundary.
- [x] Agree: record the selected design and compatibility constraints.
- [x] Implement: rich outgoing messages, inbox/reply client, receiving adapter and hook, safe retry.
- [x] Migrate: reference Mail and the local Samebase integration consumer.
- [x] Verify: package contract, failure paths, both consumers, build and local backend.
- [x] Review: remove dead paths, document behavior and any unverified release checks.

## Constraints

Keep the installed `mail` component name and current tables/indexes. Add optional schema fields
for existing records. Rename the public request key to `idempotencyKey` without rewriting stored
keys. Do not adopt Email SDK or add generic providers. Apps keep authorization and composition.
Ingestion commits before application callbacks run. Never automatically retry an uncertain send.
Only confirmed throttling may retry, within a bounded policy. Keep the Cloudflare receipt intact.

## Evidence

The preceding [component review](./convex-email-components-review.md) and
[design notes](./email-component-design.md) explain the comparison and product decisions.
The user approved this implementation after that review. Existing uncommitted research and
unrelated `.audit/` files are preserved.

## Selected design

Keep `EmailInbox` and component-owned delivery. An app-owned delivery runner was considered and
rejected because it would make each consumer register the same scheduling and sending machinery.
The read-only cross-review agreed with this choice.

The client exposes `send`, `enqueue`, `reply`, inbox creation/listing, local message/thread queries,
and read state. It accepts ordinary email fields and `idempotencyKey`. Reply accepts a parent
message ID and resolves the conversation inside the queue transaction. App wrappers authorize use.

Move receiving and signed R2 downloads from Mail into package exports. Store attachment keys,
names, content types, sizes and SHA-256 hashes, not signed URLs. Generate a fresh grant at delivery
time and check the bytes before the provider request. Plain sending needs neither R2 nor a Worker.

Schedule a component-owned hook dispatcher in the ingestion commit. The dispatcher invokes the
app hook afterward, so a missing or failing app hook cannot undo the stored message. Duplicate
ingestion schedules no second hook. Do not promise automatic retries of application callbacks.

Retry confirmed 429 responses only, at most three provider attempts. Respect the next eligible
time and fence completion/watchdog operations by attempt. `send` returns the current durable state,
including `queued` after throttling. Samebase feedback must distinguish this from failure or
acceptance rather than encourage a duplicate submission.

## Review fixes

Independent delivery and receiving reviews found three integration errors. Reply replay now tolerates
a provider ID arriving on its parent after queueing. Mail's Reply button reads the derived reply
recipient. HTML-only messages have a plain-text display fallback; Mail does not render untrusted HTML.

The existing PR review identified a provider response mismatch. Cloudflare's
[REST guide](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/#response)
omits `message_id` and `suppressed_recipients`; its
[API reference](https://developers.cloudflare.com/api/resources/email_sending/methods/send/)
includes them. Accept both documented shapes and retain optional fields only when present.
Do not invent a provider ID or suppression result. Still require success and all three core
recipient arrays. Malformed receipts remain unknown. A controlled live receipt is still required
before npm publication.

Delivery claim and completion mutations are now internal. Rejections retain the first Cloudflare
numeric error code, with HTTP status as a fallback. Packed-consumer coverage includes transactional
`enqueue`, replay, scheduled delivery, and a receipt without a provider ID.

## Verification

- `pnpm run check`: formatting, lint, type checks, generated Worker types, 15 files and 99 tests pass.
- `pnpm run build`: Mail client, server, and prerender build pass.
- `pnpm run component:codegen`: passes against Mail's development deployment, not production.
- `pnpm run component:test-package`: fresh tarball install, strict TypeScript, and two end-to-end
  consumer tests pass without workspace aliases or the authoring dependency patch. Tests cover
  send-only use and MIME ingestion through HTTP, retained history, reply, signed R2 download,
  attachment verification, provider submission, and read state. Network providers are mocked.
- `wrangler deploy --dry-run`: resolves Worker bindings and assets without uploading.
- Samebase `pnpm run dev --once`: local component bundle accepted. Package build must finish before
  consumer codegen; a concurrent build initially removed `dist` during that check, then the retry passed.
- Samebase email, feedback, and account-deletion suites: 40 tests pass. Full application type check passes.
- Account deletion during throttling completes and retains the queued email. Retries continue after
  deletion. Feedback reports queued delivery without encouraging another submission.
- Both repositories pass `git diff --check`.

## Handoff and release boundary

Package and reference app:

```text
/Users/nicu/dev/samebase/convex-cloudflare-email-inbox
```

Local Samebase consumer:

```text
/Users/nicu/.codex/worktrees/email-inbox-integration/samebase
```

The package work belongs to [PR 2](https://github.com/samebase/convex-cloudflare-email-inbox/pull/2).
The Samebase worktree still uses an absolute local package link. Do not commit that link.
Its integration cannot ship until the reviewed package has a portable released version.

No real email was sent, production deployment ran, or npm package was published in this update.
The last npm authentication check was unauthorized and was not repeated here. Before publication,
run a controlled live send and retain its redacted receipt. Then resolve npm access, publish, replace
the local link with the exact version, and finish the Samebase integration PR. Keep Mail's production
build hold until the existing cutover checks in the integration guide are complete.

Mail still provides a plain-text compose UI. HTML, Bcc, Reply-To, and outgoing attachments are package
API capabilities, not new Mail editor controls. This update did not run a browser UI check.

## Second review follow-up

The October 2 review adds three tracked findings. The `queueSend` contract now excludes `threadId`,
`inReplyTo`, `references`, and `replyToMessageId`. These values exist only on the private `queueMessage`
input and are derived by `queueReply`. The client and pagination tests use those distinct contracts.
Four validator tests confirm that each removed field is rejected without creating a message or thread.
The full check passes 103 tests.

The threading and attachment findings remain open pending one controlled live round trip. Send a
message with a named attachment to an external mailbox controlled by the owner. Compare the returned
provider ID with the actual `Message-ID`, check the received attachment bytes, reply, and confirm
the component stores that reply in the original thread. If the REST response lacks a usable ID,
investigate the transport needed for reliable threading before publication. The README records the
current limitation. No production deployment or live test has been performed for this follow-up.
