# App hosting

## October 17: from the app Worker to convex-hosting

Mail's web app moved from its own Cloudflare Worker, which Workers Builds deployed, to its Convex
deployment through [`@samebase/convex-hosting`](https://github.com/samebase/convex-hosting). The app
answers at `https://<deployment>.convex.site`. This host already received inbound mail from the
inbox Worker and served the Convex Auth routes.

What moved:

- The files of `dist/client`, with the settings of the Worker: `html_handling` `none`, the
  single-page fallback to `/index.html`, and `public/_redirects`.
- The deploy, from Workers Builds to `.github/workflows/deploy.yml`.
- The previews, from Worker preview URLs to Convex preview deployments, one for each branch.

What stayed:

- The inbox Worker and its R2 bucket. They receive and store mail, and Email Routing needs a
  Worker.
- The Convex project, and the production deploy key that the setup stack uses for the inbox.
- The setup stack and `.github/workflows/infra.yml`.

Why:

- One host. The app Worker only called `env.ASSETS.fetch`. Convex already served the HTTP routes of
  the app, so a second host and a second deploy system gave nothing.
- The same responses. convex-hosting runs Cloudflare's asset handler, so the same files and the same
  `_redirects` give the same answers. On a preview deployment, `/` answered with the prerendered
  landing page, `/_landing.html` with a 301 to `/`, an unknown route with the single-page shell, and
  a POST to the ingress route with the 401 of its handler.
- One switch. The push of the Convex functions switches the site, so the frontend and the functions
  that it calls change together.

Costs:

- The first `pnpm run dev` of a fresh checkout needs one `deploy:dev` and a restart. See
  [local setup](./local-setup.md).
- The deploy needs a key that can run internal functions. The GitHub secrets hold their own keys,
  apart from the key of the setup stack.
- A Worker answers from the data center nearest the visitor. Convex answers from the region of the
  deployment.

The setup stack no longer declares the Workers Builds link, so the next deploy of
`.github/workflows/infra.yml` on `main` disconnects Workers Builds from the repository. The app
Worker stays in the Cloudflare account, because the stack retains it. Delete it in the dashboard
when it is no longer needed.
