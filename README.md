# Samebase Mail

Samebase Mail is a private mail desk for multiple addresses on domains that you own. The first
deployment accepts `inbox@json.md` and `notes@json.md`. The owner can create more `json.md`
addresses in the app.

The app has no AI agent, MCP server, template system, or public account flow.

## Architecture

- One Cloudflare Worker receives routed email, parses MIME, serves the web app, and sends replies.
- One private R2 bucket stores complete `.eml` files and named attachments.
- Convex stores inbox rules, ingress receipts, threads, message metadata, readable bodies, and
  outbound delivery state.
- Convex Auth allows one owner email. First sign-up also needs a one-time setup code.

The Worker routes mail by the SMTP envelope recipient. This also handles BCC mail. Before it writes
to R2, it reserves `(inbox, SHA-256 of raw message)` in Convex. A repeated delivery uses the same R2
keys and cannot increment message counters twice.

R2 is not a second business database. Convex keeps every searchable field and every state
transition. R2 only keeps bytes that must retain their complete form or filename.

## Local development

Install [Vite+](https://viteplus.dev/guide/), then run:

```sh
corepack enable
pnpm install
pnpm run dev
```

The development command starts Convex and TanStack Start. It does not send real email. Use
Cloudflare's local email-event endpoint when testing the Worker handler.

The following Convex environment variables are required:

| Name                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `OWNER_EMAIL`        | The only email that can sign in                                |
| `OWNER_SETUP_SECRET` | The one-time code required for first sign-up                   |
| `MAIL_BRIDGE_SECRET` | Authenticates Worker and Convex requests and signs file grants |
| `MAIL_WORKER_URL`    | Public URL of the deployed Worker                              |

The Worker uses `MAIL_BRIDGE_SECRET` and `MAIL_RECOVERY_ADDRESS` as secrets. The recovery address
must be a verified Cloudflare Email Routing destination. It only receives a copy when storage or
the Convex handoff fails. `wrangler.jsonc` supplies the Convex site URL and binds `MAIL_STORAGE`,
`EMAIL`, and `ASSETS`.

To create the two initial inboxes in a deployment, run:

```sh
pnpm exec convex run bootstrap:defaultInboxes
```

Add `--prod` for production.

## Checks and deploys

| Command                   | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `pnpm run check`          | Format, lint, type-check, and test the app            |
| `pnpm run build`          | Run the complete Cloudflare build path                |
| `pnpm run deploy:dry-run` | Build and validate a Worker upload without publishing |
| `pnpm run deploy`         | Deploy the production Worker                          |

Cloudflare Workers Builds deploys `main` to production. The standard build scripts select the
branch's Convex deployment and preserve existing auth keys. For provider setup, use the
[Worker Previews migration guide](https://samebase.com/docs/cloudflare-previews-migration).

Mail previews use the `samebase-mail-previews` R2 bucket. The preview deploy command sets
`CONVEX_SITE_URL` to the Convex URL from that branch's build. Production mail storage and
email routing stay unchanged.

Previews Base holds test runtime settings. The Worker and Convex preview need matching test
`MAIL_BRIDGE_SECRET` values. Convex also needs the preview `MAIL_WORKER_URL`, test `OWNER_EMAIL`,
and test `OWNER_SETUP_SECRET` for first sign-up. Restrict the `EMAIL` binding to a verified test
recipient. Do not reuse production secrets or route the live inbox to a preview.

## Mail delivery rules

- Unknown inboxes get a permanent SMTP rejection.
- A parse failure still creates a visible raw-only message.
- Displayed text and HTML bodies are capped at 512 KiB. The full raw message stays in R2.
- Threads join only through `References` or `In-Reply-To`. Equal subjects stay separate.
- An outbound timeout becomes `unknown` and does not retry automatically. This prevents duplicate
  email when the provider accepted a send but its response was lost.
- The reading pane loads the latest 10 messages in a thread to keep Convex responses bounded.
- The app displays plain text. It does not render untrusted HTML.

## License

Licensed under the [Apache License 2.0](./LICENSE).
