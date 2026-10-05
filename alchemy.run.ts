// Setup stack for Mail. It keeps Workers Builds as the deployer and declares
// the setup around it: the Worker shell, its Builds link to this repository,
// the Convex project with the deploy keys the builds use, and the wiring of
// the inbox component (packages/convex-cloudflare-email-inbox/alchemy.ts).
// It never uploads Worker code; apps/mail/wrangler.jsonc stays the source of
// truth for that.
//
// The stack owns wiring, not settings. A value that a person opens a
// dashboard to check (the owner email, the setup secret, the sending token,
// the recovery address) stays in that dashboard. README.md lists them under
// "Setup stack".
//
// .github/workflows/infra.yml runs it: a plan and a drift report on every
// pull request that touches this file, a deploy on main. Locally it needs
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env (a user token with
// Workers Scripts, Workers Builds Configuration, Secrets Store, R2, Email
// Routing rules, Zone read, DNS) and the Convex CLI login:
//   npx alchemy plan --stage prod
//
// A fork changes the four names below. The repository comes from the origin
// remote of the clone, or from GITHUB_REPOSITORY in GitHub Actions.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EmailInbox } from "./packages/convex-cloudflare-email-inbox/alchemy.ts";

const WORKER_NAME = "samebase-mail";
const CONVEX_TEAM = "nicu";
const CONVEX_PROJECT = "mail";
const MAIL_ZONE = "json.md";

export default Alchemy.Stack(
  "SamebaseMail",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      WorkersBuilds.providers(),
      Convex.providers(),
    ),
    // State lives in the Cloudflare state store (an encrypted Durable Object in
    // the account), so the laptop and .github/workflows/infra.yml share it.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // Only the name: every other Worker setting stays with wrangler.jsonc.
    // Retained on destroy: this is the production Worker of a live mail app.
    const worker = yield* WorkersBuilds.Worker("Worker", { name: WORKER_NAME }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );

    // Found by name. A delete of the project deletes all of its deployments
    // and data, and each change of its props is a replacement. Retain it.
    const project = yield* Convex.Project("Project", {
      team: CONVEX_TEAM,
      name: CONVEX_PROJECT,
    }).pipe(Alchemy.RemovalPolicy.retain());
    const deployment = project.prodDeploymentName.as<string>();

    const deployKey = yield* Convex.DeployKey("DeployKey", {
      deployment,
      name: "workers-builds",
    });
    const previewKey = yield* Convex.PreviewDeployKey("PreviewDeployKey", {
      projectId: project.projectId,
      name: "workers-builds",
    });

    const builds = yield* WorkersBuilds.Repository("Builds", {
      worker: worker.workerId,
      buildCommand: "pnpm run build",
      deployCommand: "pnpm run deploy",
      previewDeployCommand: "pnpm run deploy:preview",
      buildCachingEnabled: false,
      // apps/mail/scripts/build-cloudflare.ts reads CONVEX_DEPLOY_KEY: the
      // production key on main, the project preview key on other branches.
      // Samebase reads SAMEBASE_CONVEX_PROJECT to link the Worker to its
      // Convex project in the dashboard. Same format Samebase writes itself.
      variables: {
        CONVEX_DEPLOY_KEY: deployKey.deployKey,
        SAMEBASE_CONVEX_PROJECT: Output.interpolate`version=1&teamId=${project.teamId}&projectId=${project.projectId}`,
      },
      previewVariables: { CONVEX_DEPLOY_KEY: previewKey.previewDeployKey },
    });

    yield* EmailInbox("Mail", {
      worker,
      deployment,
      deployKey: deployKey.deployKey,
      zone: MAIL_ZONE,
    });

    return { url: worker.url, previewsEnabled: builds.previewsEnabled };
  }),
);
