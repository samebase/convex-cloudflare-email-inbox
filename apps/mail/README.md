# Mail reference app

Mail uses `@samebase/convex-cloudflare-email-inbox` for its email backend. It is a private
mail desk for multiple addresses on domains that you own. The first deployment accepts
`inbox@json.md` and `notes@json.md`. The owner can create more `json.md`
addresses in the app.

The app has no AI agent, MCP server, template system, or public account flow.

## Architecture

- The inbox Worker on Cloudflare receives routed email, parses MIME, and streams downloads.
- The Convex deployment serves the web app through `@samebase/convex-hosting`.
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

On a fresh checkout or worktree, the first push fails with
`Could not resolve "../.convex-hosting/version.js"`, and the frontend waits. Run
`pnpm --filter samebase-mail run deploy:dev` once in a second terminal. It builds the app, uploads
it to the development deployment, writes that file, and pushes. Then stop `pnpm run dev` and start
it again.

Mail's local environment files live in `apps/mail`, beside `convex.json`.
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
set by hand. Sending runs in the Convex component, not a Worker.

To create the two initial inboxes in a deployment, run:

```sh
pnpm --filter samebase-mail exec convex run bootstrap:defaultInboxes
```

Add `--prod` for production.

## Checks and deploys

Run these in `apps/mail`:

| Command               | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `pnpm run check`      | Format, lint, type-check, and test the app                   |
| `pnpm run build`      | Build the app into `dist/client`                             |
| `pnpm run deploy`     | Build the app and deploy it with the functions to production |
| `pnpm run deploy:dev` | The same, to the development deployment of this checkout     |

The deploy commands run `convex-hosting deploy`. It builds the app, uploads `dist/client` to the
`hosting` component, and pushes the Convex functions. The push switches the site. The files keep
the settings of the former Worker: `html_handling` is `none`, and a route without a file gets the
single-page shell `/index.html`. `public/_redirects` serves the prerendered landing page at `/`
and redirects `/_landing.html` to `/`, with Cloudflare's rules. The Convex Auth and mail ingress
routes in `convex/http.ts` are exact paths or longer prefixes, so they win over the site. Deploy
with these commands, never with a plain `npx convex deploy`, which pushes the version of the last
deploy from this checkout.

`.github/workflows/deploy.yml` deploys `main` to production at `https://<deployment>.convex.site`
after `pnpm run check`, through the
[deploy action](https://github.com/samebase/convex-hosting/blob/main/docs/deploy.md#github-actions)
of convex-hosting. `.github/workflows/preview.yml` deploys each pull request from this repository
to a Convex preview named after its branch, comments its `.convex.site` URL on the pull request, and
deletes the preview when the pull request closes. Each deploy creates the Convex Auth keys when a
new deployment has none. The workflows read `CONVEX_DEPLOY_KEY` and `CONVEX_PREVIEW_DEPLOY_KEY` from
repository secrets; see the [setup stack](../../README.md#credentials). Previews receive no mail and
have no file storage. Production mail storage and email routing stay unchanged.

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
