# Convex Cloudflare Email Inbox

`@samebase/convex-cloudflare-email-inbox` is a Convex component for Cloudflare email sending,
inboxes, threads, and delivery history. Every send has a stored message record, including app
notifications that never receive replies.

## Use the package

```sh
pnpm add @samebase/convex-cloudflare-email-inbox convex
```

The [package guide](./packages/convex-cloudflare-email-inbox/README.md) covers installation,
Cloudflare credentials, sending, history, and tests. Sending runs inside Convex. Receiving uses
the package's Cloudflare Worker helpers and your R2 bucket. Mail is the reference integration.

For a read-only monitor inside your existing React app, use
[`@samebase/convex-cloudflare-email-inbox-ui`](./packages/convex-cloudflare-email-inbox-ui/README.md).
The host app supplies authorized Convex queries and keeps its own login and access policy.

## Repository layout

```text
packages/convex-cloudflare-email-inbox/  Published component and its tests
packages/convex-cloudflare-email-inbox-ui/  Optional React monitor and message reader
apps/mail/                             Mail application and deployment configuration
docs/                                  Design decisions and development guides
scripts/                               Workspace development and package verification
```

[Mail](./apps/mail/README.md) is a working private mail app for multiple inboxes on your domains.
It is also the example consumer and starting point for building a mail app with the component.
The app uses the package through `workspace:*`, so package changes are exercised in the same checkout.

The repository root owns shared tooling and commands. Application dependencies and configuration
live in `apps/mail`. The npm package has its own exports, dependencies, and release version.

## Develop and verify

Install [Vite+](https://viteplus.dev/guide/), then run these commands from the repository root:

```sh
corepack enable
pnpm install
pnpm run dev
```

The development command builds and watches both packages, then starts Mail's Convex backend and
frontend. See [local setup](./docs/local-setup.md) for deployment selection and app environment files.

| Command                           | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `pnpm run check`                  | Check formatting, lint, types, and tests across all workspaces           |
| `pnpm run build`                  | Build the component and the Mail app through its Cloudflare build script |
| `pnpm run component:test-package` | Install and test the packed package in a fresh consumer                  |
| `pnpm run component:codegen`      | Generate component types using Mail's Convex project                     |
| `pnpm run deploy:dry-run`         | Build and validate the Mail Worker without uploading it                  |

Cloudflare Workers Builds can keep its repository root at `/`. Root `build`, `deploy`, and
`deploy:preview` commands delegate to Mail with `apps/mail` as the working directory. The Worker
configuration, assets, and Convex deployment selection resolve there.

`apps/mail/cloudflare.config.ts` is the configuration of the Worker, in the format of the
[Cloudflare CLI](https://developers.cloudflare.com/cf/projects/cloudflare-config/) (`cf`). The
build writes the Build Output of the Worker with the Wrangler bundler, and `cf deploy --prebuilt`
or `cf previews deploy --prebuilt` uploads it. `apps/mail/wrangler.config.ts` holds the build
settings of the Wrangler bundler, such as the assets directory. Workers Builds runs the same package
scripts as before: `pnpm run build`, `pnpm run deploy`, and `pnpm run deploy:preview`.

The [integration guide](./docs/integration.md) covers development across repositories and the
production rollout. The [design and OpenSend review](./docs/email-component-design.md) records
decisions, verification, and questions for reviewers.

## License

Licensed under [Apache License 2.0](./LICENSE).

## Setup stack

`alchemy.run.ts` declares the setup around Workers Builds: the Worker, its Workers Builds link to
this repository, the Convex project with the deploy keys the builds use, and the inbox wiring from
`@samebase/convex-cloudflare-email-inbox/alchemy`: the production `MAIL_BRIDGE_SECRET` on the
Worker and in Convex, `MAIL_WORKER_URL` in Convex, and the catch-all rule of the mail zone. Workers
Builds deploys the code from `apps/mail/cloudflare.config.ts`, which also names the two mail
buckets that the Worker binds. The stack never uploads code; it imports the Worker name from that
file. `.github/workflows/infra.yml` runs the stack: a plan and a drift report on pull requests that
touch these files, and a deploy on `main`. The state is in Alchemy's Cloudflare state store.

The stack owns wiring, not settings. It declares only values that two sides must share and that
nobody edits by hand. The settings below stay in the dashboards, where you can read and change
them.

### Credentials

Put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env` for local runs. The workflow reads
them and `CONVEX_ACCESS_TOKEN` (a Convex team access token) from repository secrets. Locally, the
Convex CLI login is enough. The API token needs these permissions: Workers Scripts, Workers Builds
Configuration, Account Settings Read, Secrets Store, Email Routing Rules, Zone Read, and DNS.

### Settings the stack does not touch

| Where                                                | Name                          | Value                                                                                       |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| Convex production, and preview defaults              | `OWNER_EMAIL`                 | The only email that can sign in                                                             |
| Convex production, and preview defaults              | `OWNER_SETUP_SECRET`          | The code for the first sign-up                                                              |
| Convex production                                    | `CLOUDFLARE_EMAIL_API_TOKEN`  | Cloudflare Email Sending token                                                              |
| Convex production, and preview defaults              | `CLOUDFLARE_EMAIL_ACCOUNT_ID` | Cloudflare account of the verified sending domain                                           |
| Worker secret                                        | `MAIL_RECOVERY_ADDRESS`       | Gets a copy of the mail that the Worker cannot store. A verified Email Routing destination. |
| Worker preview settings, and Convex preview defaults | `MAIL_BRIDGE_SECRET`          | One random value for previews, the same in both places                                      |

### Manual steps

1. Install the Cloudflare Workers and Pages GitHub App on the repository, once for each account.
   Start from **Workers & Pages** in the Cloudflare dashboard.
2. Enable Email Routing on the mail zone, and verify the recovery address as a destination, in the
   Cloudflare dashboard.
3. Create the two R2 buckets that `apps/mail/cloudflare.config.ts` names: `<worker>` for
   production mail and `<worker>-previews` for previews.
4. Set the settings above.

### Fresh install

1. Fork the repository. Change the three values at the top of `alchemy.run.ts` and the Worker name
   in `apps/mail/cloudflare.config.ts`.
2. Create the Alchemy state store once for each Cloudflare account:
   `npx alchemy provider cloudflare bootstrap`.
3. Do manual steps 1 to 3.
4. Run `npx alchemy deploy --stage prod`.
5. Do manual step 4.
6. Push once to `main`. Workers Builds then deploys Convex and the Worker.

A second install in the same account needs a new stack name and Worker name. The bucket names
follow the Worker name, so they need no change. The app
names its mail domain `json.md` in `apps/mail/convex/bootstrap.ts` and
`apps/mail/src/components/mail/MailWorkspace.tsx`. For a different zone, change the domain in these
two files.
