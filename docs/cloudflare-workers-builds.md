# Cloudflare Workers Builds

Cloudflare Workers Builds uses these repository commands:

| Stage  | Production        | Preview                   |
| ------ | ----------------- | ------------------------- |
| Build  | `pnpm run build`  | `pnpm run build`          |
| Deploy | `pnpm run deploy` | `pnpm run deploy:preview` |

The build, auth, and branch-head scripts match the Samebase starter. Mail keeps its
`wrangler types` step in `build:app`. Local builds do not deploy Convex.
Provider builds deploy the selected Convex backend, build the app, and preserve existing auth keys.
A failed auth read or partial key pair stops the build without replacing keys.

Each non-production build uses `WORKERS_CI_BRANCH` as its named Convex preview.
The auth script uses the same preview name. Repeated builds preserve its data and auth keys.
Before Convex publishes functions, the branch-head script rejects a stale checkout.
This check also applies to production.

## Build secrets

`CONVEX_DEPLOY_KEY` is a build secret, not a Worker runtime secret.
Production build settings use the production deployment key.
Previews Base build settings use the project Preview key.
`SAMEBASE_CONVEX_PROJECT` stays on Production build settings.
The scripts do not read `PREVIEW_CONVEX_DEPLOY_KEY`.

For provider setup and the one-time switch, use the
[Worker Previews migration guide](https://samebase.com/docs/cloudflare-previews-migration).

## Local package check

This command builds the app and validates the production Worker package without publishing:

```sh
pnpm run deploy:dry-run
```

Worker Previews has no dry-run mode. Do not publish a Mail preview until its runtime is isolated.

## Mail preview runtime is incomplete

This PR stays draft. The empty `previews` block does not inherit the production R2 bucket,
Convex site URL, or email binding. A Preview URL can exist with missing bindings.
Do not enable live preview builds or merge until the following settings use test resources:

| Setting                                       | Required preview value                          |
| --------------------------------------------- | ----------------------------------------------- |
| `previews.vars.CONVEX_SITE_URL`               | Site URL of the branch's Convex preview         |
| `previews.r2_buckets` binding `MAIL_STORAGE`  | Separate test R2 bucket                         |
| `previews.send_email` binding `EMAIL`         | Restricted test email configuration             |
| Worker and Convex `MAIL_BRIDGE_SECRET`        | Matching test secret, different from production |
| Worker `MAIL_RECOVERY_ADDRESS`                | Verified test recovery destination              |
| Convex `MAIL_WORKER_URL`                      | This branch's Worker Preview URL                |
| Convex `OWNER_EMAIL` and `OWNER_SETUP_SECRET` | Test owner and first-sign-up code               |

The top-level `ASSETS` binding serves the branch's built assets. It needs no separate storage.
Keep production R2, backend, email routing, and secrets unchanged.
Use test mail to verify inbound R2 storage, file grants, recovery, and outbound delivery.
Local build and unit tests do not prove this runtime isolation.

The production Worker writes raw messages and attachments to R2.
It calls the Convex site through the bridge secret, sends mail through `EMAIL`,
and forwards failed inbound deliveries to the recovery address.
Copying production values into `previews` can expose production messages or send real mail.
See [Cloudflare Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/)
for settings that require explicit preview values.
