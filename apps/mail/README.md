# Mail reference app

Mail uses `@samebase/convex-cloudflare-email-inbox` for its email backend. It is a private
mail desk for multiple addresses on domains that you own. The first deployment accepts
`inbox@json.md` and `notes@json.md`. The owner can create more `json.md`
addresses in the app.

The app has no AI agent, MCP server, template system, or public account flow.

## Architecture

- One Cloudflare Worker receives routed email, parses MIME, serves the web app, and streams downloads.
- One private R2 bucket stores complete `.eml` files and named attachments.
- The component in `packages/convex-cloudflare-email-inbox` stores inbox rules, ingress receipts, threads,
  message metadata, readable bodies, and outbound delivery state. It sends through Cloudflare REST.
- Convex Auth allows one owner email. First sign-up also needs a one-time setup code.

The app keeps owner authentication and Cloudflare Email Routing in thin adapters. It mounts the
package's receiving and signed R2 download helpers. The component owns the reusable mail schema and business
logic. This boundary lets another Convex app install the mail backend without taking the current
app shell or Cloudflare configuration. See the [package README](../../packages/convex-cloudflare-email-inbox/README.md) for
installation, sending, receiving, and inbox methods.

The Worker routes mail by the SMTP envelope recipient. This also handles BCC mail. Before it writes
to R2, it reserves `(inbox, SHA-256 of raw message)` in Convex. A repeated delivery uses the same R2
keys and cannot increment message counters twice.

R2 is not a second business database. Convex keeps every searchable field and every state
transition. R2 only keeps bytes that must retain their complete form or filename.

## Local development

Install [Vite+](https://viteplus.dev/guide/), then run from the repository root:

```sh
corepack enable
pnpm install
pnpm run dev
```

The development command builds and watches the package, then starts Convex and TanStack Start.
Leave Cloudflare sending credentials unset locally to prevent real email.

Mail's local environment files live in `apps/mail`, beside `convex.json` and `cloudflare.config.ts`.
The following Convex environment variables configure the app:

| Name                          | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `OWNER_EMAIL`                 | The only email that can sign in                                |
| `OWNER_SETUP_SECRET`          | The one-time code required for first sign-up                   |
| `MAIL_BRIDGE_SECRET`          | Authenticates Worker and Convex requests and signs file grants |
| `MAIL_WORKER_URL`             | Public URL of the inbox Worker                                 |
| `CLOUDFLARE_EMAIL_API_TOKEN`  | Cloudflare Email Sending token, required to send               |
| `CLOUDFLARE_EMAIL_ACCOUNT_ID` | Cloudflare account for the verified sending domain             |

Mail is received, stored, and served by the inbox Worker that the [setup stack](../../README.md#setup-stack)
uploads from the component, with its own R2 bucket. The stack sets `MAIL_BRIDGE_SECRET` on that
Worker and in Convex production, and `MAIL_WORKER_URL` in Convex production. The other variables are
set by hand. The app Worker in `cloudflare.config.ts` serves the built app only. Sending runs in the
Convex component, not a Worker.

To create the two initial inboxes in a deployment, run:

```sh
pnpm --filter samebase-mail exec convex run bootstrap:defaultInboxes
```

Add `--prod` for production.

## Checks and deploys

| Command                   | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `pnpm run check`          | Format, lint, type-check, and test the app            |
| `pnpm run build`          | Run the complete Cloudflare build path                |
| `pnpm run deploy:dry-run` | Build and validate a Worker upload without publishing |
| `pnpm run deploy`         | Deploy the production Worker after the Workers build  |

`cloudflare.config.ts` is the configuration of the Worker. The build writes its Build Output to
`.cloudflare/output/v0/` with the Wrangler bundler (`scripts/build-worker.ts`), and the deploy
commands upload that output with `cf deploy --prebuilt` or `cf previews deploy --prebuilt`.
`wrangler.config.ts` holds the build settings of the Wrangler bundler. `cf workers types` writes
the `Env` type of the Worker to `.cloudflare/types/index.d.ts`.

Cloudflare Workers Builds deploys `main` to production. The standard build scripts select the
branch's Convex deployment and preserve existing auth keys. For provider setup, use the
[Worker Previews migration guide](https://samebase.com/docs/cloudflare-previews-migration).

A Workers build on a branch other than `main` writes a Preview build of the app Worker. The preview
deploy command uploads it and sets `SITE_URL` in the Convex preview of the branch. Previews receive
no mail and have no file storage. Production mail storage and email routing stay unchanged.

Set `OWNER_EMAIL`, `OWNER_SETUP_SECRET`, and `CLOUDFLARE_EMAIL_ACCOUNT_ID` as Convex project
defaults for preview deployments. Leave sending credentials unset in previews unless they use an
isolated test account.

## Mail delivery rules

- Unknown inboxes get a permanent SMTP rejection.
- A parse failure still creates a visible raw-only message.
- Displayed text and HTML bodies are capped at 512 KiB. The full raw message stays in R2.
- Threads join only through `References` or `In-Reply-To`. Equal subjects stay separate.
- An outbound timeout becomes `unknown` and does not retry automatically. This prevents duplicate
  email when the provider accepted a send but its response was lost.
- Confirmed HTTP 429 throttling schedules at most three attempts and respects `Retry-After`.
- The reading pane loads the latest 10 messages in a thread to keep Convex responses bounded.
- The app displays plain text. It does not render untrusted HTML.

## License

Licensed under the [Apache License 2.0](../../LICENSE).
