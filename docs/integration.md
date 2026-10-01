# Shared email integration

The canonical component is `packages/convex-cloudflare-email-inbox` in this repository. The Mail
reference application lives in `apps/mail`. Samebase installs the same built package and configures `notifications@samebase.com`
as its sending inbox. No generic Cloudflare API package, agent, MCP server, or template work is
included in this integration.

The [design and OpenSend review](./email-component-design.md) records the API decisions, current
verification, release conditions, and questions for reviewers.

The component owns message history, delivery state, request deduplication, and Cloudflare transport.
Applications own recipient selection, message composition, authorization, and retention policy.
Mail keeps its inbound Worker and R2 bucket. Sending-only Samebase does not add either.

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
notification after the user transaction. Feedback waits for acceptance and rejects bounced or
suppressed recipients. Account deletion sends once, records failure when needed, and still finalizes.
Samebase's internal notification history survives user-account scrubbing, as documented in its
privacy policy and deletion spec. No public history endpoint is added.

Before the Mail update, stop new sends and let all old queued and sending messages finish. Confirm
that no scheduled `internal.delivery.send` actions remain before deploying the removal of that action.
Its pending jobs cannot run after removal. Do not resend messages whose delivery is uncertain.

Mail's sending deployment needs the Cloudflare account and Email Sending token before switching
off its old Worker bridge. Inbound routing, R2 keys, and object signing stay unchanged. The production
Cloudflare build command is already held pending the component extraction PR; restore it only after
the reviewed package and credentials are ready. Do not deploy the old app schema over component data.
