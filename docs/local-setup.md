# Local setup

Use this when you want to run the app from your own computer instead of only
through Cloudflare.

## Install Vite+

On macOS or Linux:

```sh
curl -fsSL https://vite.plus | bash
```

On Windows PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

Open a new terminal after installing Vite+. Enable the package-manager shims, then install
dependencies:

```sh
corepack enable
pnpm install
```

## Run the app

From the repository root:

```sh
pnpm run dev
```

`pnpm run dev` starts Convex and TanStack Start together. On the first run,
Convex may ask you to sign in and choose or create a development deployment.
The dev script also creates Convex Auth JWT keys in that development deployment
if they are missing. In a linked Git worktree, it automatically uses an isolated
local backend.

Open the local URL printed by Vite.

Mail's frontend, Convex wrappers, Worker, and app scripts live in `apps/mail`. Put local `.env.local`
and `.dev.vars` files there. The component lives in `packages/convex-cloudflare-email-inbox`, and the
root development command watches it while the app runs.

Run app-specific Convex commands from the repository root with the workspace filter:

```sh
pnpm --filter samebase-mail exec convex dashboard
```

## Force worktree mode

Use the normal `pnpm run dev` command in a linked Git worktree. Use the explicit
worktree command to force an isolated local backend in another checkout.

```sh
pnpm run dev:worktree
```

The context launcher selects `run-primary-dev.ts` or `run-worktree-dev.ts`.
Both modes use the same Windows-safe service launcher. The three launcher files
carry one shared content hash in their first line, and `pnpm run check` verifies
that hash.
