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
the Mail app's Cloudflare Worker and R2 integration.

The first package release is pending. The workspace package is available for local integration;
the registry installation command applies after publication.

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
