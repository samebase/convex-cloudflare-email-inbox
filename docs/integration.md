# Shared email integration

The canonical component is `packages/convex-cloudflare-email-inbox` in this repository. The Mail
reference application lives in `apps/mail`. Samebase installs the same built package and configures `notifications@samebase.com`
as its sending inbox. No generic Cloudflare API package, agent, MCP server, or template work is
included in this integration.

The [design and OpenSend review](./email-component-design.md) records the API decisions, current
verification, release conditions, and questions for reviewers.

The component owns message history, delivery state, request deduplication, and Cloudflare transport.
Applications own recipient selection, message composition, authorization, and retention policy.
Mail uses the package's receiving Worker helpers with its R2 bucket. Sending-only Samebase does not
add either. The package reads Worker configuration only when sending R2 attachments.

## Develop across repositories

In this repository:

```sh
pnpm install
pnpm run component:codegen
pnpm run component:build
pnpm run component:watch
```

In a separate Samebase integration worktree, temporarily link the package, using your checkout path:

```sh
pnpm --filter samebase add @samebase/convex-cloudflare-email-inbox@link:/absolute/path/to/convex-cloudflare-email-inbox/packages/convex-cloudflare-email-inbox
pnpm run dev --once
pnpm run dev
```

Codegen must finish before package build, and package build before consumer codegen. The consumer
uses built exports, not imports into another repository's source. Changes to component function
signatures need component codegen followed by a build and consumer codegen. Normal implementation
changes are rebuilt by the watcher.

Mail's local `.env.local` and `.dev.vars` files belong in `apps/mail`. App-specific commands run
through `pnpm --filter samebase-mail ...`. Cloudflare can keep its build root at `/` because the root
`build`, `deploy`, and `deploy:preview` scripts delegate to the app's directory.

Before shipping, replace the temporary link with the exact published version and regenerate the
lockfile. Never commit an absolute local dependency. `pnpm run component:test-package` checks the
tarball in a fresh consumer with no workspace aliases or patched dependencies.

The authoring workspace retains a narrow TypeScript-only `convex-helpers` patch because its current
source fails `exactOptionalPropertyTypes`. Published consumers use built declarations and the
unmodified runtime dependency. The packed consumer check verifies this boundary.

## Compatibility and rollout

Keep the installed component name `mail`, table names, and existing indexes. Moving the source into
an npm package must not create a new data namespace. New sender names and accepted-recipient
results are optional for existing records. Old accepted messages remain readable and are never resent.

Samebase preserves its deployment prefix and local credential skip behavior. Signup schedules its
notification after the user transaction. Feedback reports acceptance, rejects bounced or suppressed
recipients, and reports queued delivery after confirmed throttling without asking for resubmission.
Account deletion records unconfirmed delivery when needed and still finalizes. The component retries
confirmed HTTP 429 responses only, at most three provider attempts. Uncertain outcomes do not retry.
Samebase's internal notification history survives user-account scrubbing, as documented in its
privacy policy and deletion spec. No public history endpoint is added.

When removing a scheduled action, first check for queued or running jobs that target it. Do not
resend messages whose delivery is uncertain. The October 2 Mail rollout had no queued or sending
messages, so no queue drain or data migration was needed.

Mail's sending deployment needs the Cloudflare account and Email Sending token before switching
off its old Worker bridge. Use a separate Email Sending token for each app so each credential can be
replaced independently. Inbound routing, R2 keys, and object signing stay unchanged. The production
Cloudflare build command was restored to `pnpm run build` on October 2 after the reviewed extraction
was merged and the sending credentials were configured. Do not deploy the old app schema over component data.

## October 2 live rollout

The production app uses the installed `mail` component. Before and after deployment, all seven mail
tables had identical exported bytes. Existing messages, inboxes, login, and R2 files were preserved.
The backup remains private and is not part of this repository.

The existing `json.md` sending registration was enabled but returned `sending_disabled`. Resetting
that registration restored sending. Its Cloudflare registration ID changed; the expected DNS records,
public DNS, and active Email Routing configuration did not change. This result does not establish
when or why Cloudflare's previous registration stopped working.

The first live text attachment roundtrip changed 37 bytes to 38. Structured sending produced a 7bit
MIME attachment, which the receiving parser decoded with an extra newline. Attachment sends now use
Cloudflare's raw MIME API with base64 parts. Sends without attachments keep the structured API.

The repeated live test preserved all 37 bytes and the SHA-256 digest. Cloudflare's returned message ID
matched the received message ID. A reply from the Mail UI was accepted, received, and stored in the
same two inbox threads, with two messages in each. These tests used only controlled test messages
between two owner-controlled inboxes, not an independent external mail provider.

The source repository is public. npm publication and the Samebase consumer release remain
separate release steps.
