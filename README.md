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

## Repository layout

```text
packages/convex-cloudflare-email-inbox/  Published component and its tests
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

The development command builds and watches the component, then starts Mail's Convex backend and
frontend. See [local setup](./docs/local-setup.md) for deployment selection and app environment files.

| Command                           | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `pnpm run check`                  | Check formatting, lint, types, and tests across both workspaces          |
| `pnpm run build`                  | Build the component and the Mail app through its Cloudflare build script |
| `pnpm run component:test-package` | Install and test the packed package in a fresh consumer                  |
| `pnpm run component:codegen`      | Generate component types using Mail's Convex project                     |
| `pnpm run deploy:dry-run`         | Build and validate the Mail Worker without uploading it                  |

Cloudflare Workers Builds can keep its repository root at `/`. Root `build`, `deploy`, and
`deploy:preview` commands delegate to Mail with `apps/mail` as the working directory. The Worker
configuration, assets, and Convex deployment selection resolve there.

The [integration guide](./docs/integration.md) covers development across repositories and the
production rollout. The [design and OpenSend review](./docs/email-component-design.md) records
decisions, verification, and questions for reviewers.

## License

Licensed under [Apache License 2.0](./LICENSE).

## Setup stack

`alchemy.run.ts` declares the full Mail install: the Worker and its secrets, its Workers Builds
link to this repository, the Convex project with its deploy keys and variables, the two mail
buckets, the recovery address, and the catch-all rule of the mail zone. Workers Builds deploys the
code from `apps/mail/wrangler.jsonc`. The stack never uploads code. `.github/workflows/infra.yml`
runs the stack: a plan and a drift report on pull requests that touch the file, and a deploy on
`main`. The state is in Alchemy's Cloudflare state store.

The file holds no ids of one install. The stack name `SamebaseMail` gives the app name
`samebase-mail`. The Worker, the Convex project, the buckets (`samebase-mail` and
`samebase-mail-previews`), and the catch-all rule use the app name. A stage other than `prod` adds
the stage to the name. The repository comes from the `origin` remote of the clone, or from
`GITHUB_REPOSITORY` in GitHub Actions.

### Inputs

Put the inputs in `.env` for local runs. Set them as repository secrets and variables for the
workflow.

| Name                         | In GitHub          | Value                                                          |
| ---------------------------- | ------------------ | -------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | Secret             | Cloudflare user API token, see the permissions below           |
| `CLOUDFLARE_ACCOUNT_ID`      | Secret             | Cloudflare account. Convex also sends mail through it.         |
| `CONVEX_ACCESS_TOKEN`        | Secret             | Convex team access token. Locally, the Convex login is enough. |
| `CONVEX_TEAM`                | Variable           | Convex team slug                                               |
| `CONVEX_PROJECT`             | Variable, optional | Convex project name. The default is the app name.              |
| `MAIL_ZONE`                  | Variable           | Cloudflare zone that receives the mail, such as `example.com`  |
| `OWNER_EMAIL`                | Secret             | The only email that can sign in                                |
| `OWNER_SETUP_SECRET`         | Secret             | The code for the first sign-up                                 |
| `MAIL_RECOVERY_ADDRESS`      | Secret             | Gets a copy of the mail that the Worker cannot store           |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Secret             | Cloudflare Email Sending token for Convex production           |

The API token needs these permissions: Workers Scripts, Workers Builds Configuration, Account
Settings Read, Secrets Store, Workers R2 Storage, Email Routing Rules, Email Routing Addresses, Zone
Read, and DNS. The stack makes the
production `MAIL_BRIDGE_SECRET` itself and writes it to the Worker and to Convex production.

The workflow keeps `OWNER_EMAIL` in a secret: the plan prints the values that are not secrets,
and the workflow logs of a public repository are public.

### Manual steps

The stack does not do these steps:

1. Install the Cloudflare Workers and Pages GitHub App on the repository, once for each account.
   Start from **Workers & Pages** in the Cloudflare dashboard.
2. Enable Email Routing on the mail zone in the Cloudflare dashboard, once for each zone.
3. Click the link in the verification mail that Cloudflare sends to `MAIL_RECOVERY_ADDRESS`.
4. For Worker Previews, make one random preview `MAIL_BRIDGE_SECRET`. Set it in two places: the
   preview settings of the Worker in the Cloudflare dashboard, and the preview default
   environment variables of the Convex project.

### Fresh install

1. Fork the repository.
2. Create the Alchemy state store once for each Cloudflare account:
   `npx alchemy provider cloudflare bootstrap`.
3. Do manual steps 1 and 2.
4. Set the inputs in `.env`, and as repository secrets and variables.
5. Run `npx alchemy deploy --stage prod`.
6. Do manual step 3.
7. Push once to `main`. Workers Builds then deploys Convex and the Worker.

A fork in its own Cloudflare account and Convex team can keep the stack name. A second install in
the same account needs a new stack name. Then also change the two bucket names in
`apps/mail/wrangler.jsonc` to `<app>` and `<app>-previews`. The app names its mail domain
`json.md` in `apps/mail/convex/bootstrap.ts` and `apps/mail/src/components/mail/MailWorkspace.tsx`.
For a different `MAIL_ZONE`, change the domain in these two files.

This install was made before the stack. Its Convex project has the name `mail`, so it sets
`CONVEX_PROJECT=mail`.
