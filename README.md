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

| Command                           | Purpose                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `pnpm run check`                  | Check formatting, lint, types, and tests across all workspaces |
| `pnpm run build`                  | Build both packages and the Mail app                           |
| `pnpm run component:test-package` | Install and test the packed package in a fresh consumer        |
| `pnpm run component:codegen`      | Generate component types using Mail's Convex project           |

Mail's own Convex deployment serves the app through
[`@samebase/convex-hosting`](https://github.com/samebase/convex-hosting), at
`https://<deployment>.convex.site`. `.github/workflows/deploy.yml` deploys `main` to production,
and `.github/workflows/preview.yml` deploys each pull request to a Convex preview deployment. The
[Mail README](./apps/mail/README.md#checks-and-deploys) describes the deploy.

The [integration guide](./docs/integration.md) covers development across repositories and the
production rollout. The [design and OpenSend review](./docs/email-component-design.md) records
decisions, verification, and questions for reviewers. The [app hosting note](./docs/app-hosting.md)
records why the app moved from its Worker to convex-hosting.

## License

Licensed under [Apache License 2.0](./LICENSE).

## Setup stack

`apps/mail/alchemy.run.ts` declares the setup around the app: the Convex project with a production
deploy key, and the inbox from `@samebase/convex-cloudflare-email-inbox/alchemy`. The inbox is its
own Worker, an Alchemy Worker that the component package ships and Alchemy bundles at deploy time,
and an R2 bucket, with names that Alchemy generates. It also declares the sending domain and creates
an Email Sending token. The app writes the package's four environment outputs to Convex and passes
them to its mounted `mail` component. The inbox enables Email Routing on the mail zone and
points the zone's catch-all rule at itself. The app has no Worker: its Convex deployment serves it,
and `.github/workflows/deploy.yml` deploys it. Run the `alchemy` commands in `apps/mail`.
`.github/workflows/infra.yml` runs the stack there: a plan and a drift report on pull requests that
touch these files, and a deploy on `main`. The state is in Alchemy's Cloudflare state store.

The stack owns the mail infrastructure and credentials. Owner access settings stay in the Convex
dashboard.

### Credentials

Put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `apps/mail/.env` for local runs. The workflow reads
them and `CONVEX_ACCESS_TOKEN` (a Convex team access token) from repository secrets. Locally, the
Convex CLI login is enough. The API token needs these permissions: Workers Scripts, Workers R2
Storage, Account Settings Read, Secrets Store, Email Routing Rules, Zone Read, DNS, Email Sending,
and account **API Tokens Write**. Email Routing Rules and DNS edit cover the routing: enabling
Email Routing writes the zone's MX and SPF records. API Tokens Write lets Alchemy create the
runtime sending token. That token has only Email Sending Write permission for the account.

The deploy workflows read two other repository secrets: `CONVEX_DEPLOY_KEY`, a production deploy
key, and `CONVEX_PREVIEW_DEPLOY_KEY`, a preview deploy key of the project. The
[deploy guide](https://github.com/samebase/convex-hosting/blob/main/docs/deploy.md#deploy-tools-and-ci)
of convex-hosting shows how to create them and store them with `gh secret set`.

### Settings the stack does not touch

| Where                                   | Name                 | Value                           |
| --------------------------------------- | -------------------- | ------------------------------- |
| Convex production, and preview defaults | `OWNER_EMAIL`        | The only email that can sign in |
| Convex production, and preview defaults | `OWNER_SETUP_SECRET` | The code for the first sign-up  |

### Manual steps

1. Set the settings above.
2. Create the two deploy keys of the deploy workflows as repository secrets.

### Fresh install

1. Fork the repository. Change the three values at the top of `apps/mail/alchemy.run.ts`.
2. In `apps/mail`, create the Alchemy state store once for each Cloudflare account:
   `npx alchemy provider cloudflare bootstrap`.
3. In `apps/mail`, run `npx alchemy plan --stage prod`, then `npx alchemy deploy --stage prod`.
   If the sending domain already exists, review the adoption plan and use `--adopt` on deployment.
4. Do the manual steps.
5. Push once to `main`. `.github/workflows/deploy.yml` then deploys Convex and the app.

A second install in the same account needs a new stack name. Alchemy generates the
inbox Worker and bucket names from the stack name, so they need no change. The app
names its mail domain `json.md` in `apps/mail/convex/bootstrap.ts` and
`apps/mail/src/components/mail/MailWorkspace.tsx`. For a different zone, change the domain in these
two files.

### Existing Mail stack

The package now returns environment values instead of writing to Convex itself. The reference app
keeps its existing Convex provider and environment resource IDs, so this change does not migrate
the deployment provider or replace the receiving Worker and bucket. It adds a sending domain
resource and a sending token, then sets `CLOUDFLARE_EMAIL_API_TOKEN` and
`CLOUDFLARE_EMAIL_ACCOUNT_ID` from their outputs.

Before the first deployment, give the provisioning token Email Sending and account API Tokens
Write permission. The existing `json.md` sending registration needs explicit adoption. Review
`npx alchemy plan --stage prod --adopt` and deploy through the infra workflow's `adopt` input.
The old manually configured sending token is not revoked by this change; revoke it after checking
delivery with the new token. Removing the stack revokes its generated token but retains the
shared sending domain and routing. Stored mail stays unless `DESTROY_APP` is `true`.
