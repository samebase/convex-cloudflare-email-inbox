// Setup stack for Mail. It keeps Workers Builds as the deployer and declares
// the setup around it: the Worker shell, its Builds link to this repository,
// the Convex project with the deploy keys the builds use, and the wiring of
// the inbox component (@samebase/convex-cloudflare-email-inbox/alchemy).
// It never uploads Worker code; apps/mail/cloudflare.config.ts stays the
// source of truth for that, and this file imports the Worker name from it.
//
// The stack owns wiring, not settings. A value that a person opens a
// dashboard to check (the owner email, the setup secret, the sending token,
// the recovery address) stays in that dashboard. README.md lists them under
// "Setup stack".
//
// .github/workflows/infra.yml runs it: a plan and a drift report on every
// pull request that touches this file, a deploy on main. Locally it needs
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env (a user token with
// Workers Scripts, Workers Builds Configuration, Secrets Store, Email
// Routing rules, Zone read, DNS) and the Convex CLI login:
//   npx alchemy plan --stage prod
//
// A fork changes the three values below and the Worker name in
// apps/mail/cloudflare.config.ts. The repository comes from the origin
// remote of the clone, or from GITHUB_REPOSITORY in GitHub Actions.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox/alchemy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { worker as mailWorker } from "./apps/mail/cloudflare.config.ts";

// The team id, not the slug: CI authenticates with a team access token, and
// Convex answers the slug lookup only for a user login.
const CONVEX_TEAM = 38516;
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
    // Only the name: every other Worker setting stays with cloudflare.config.ts.
    // Retained on destroy: this is the production Worker of a live mail app.
    const worker = yield* WorkersBuilds.Worker("Worker", { name: mailWorker.name }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );

    // Found by name when it has no state, then by id. A delete of the
    // project deletes all of its deployments and data. Convex.Project
    // retains by default since alchemy-convex 0.2.0; the explicit retain
    // keeps that visible here.
    const project = yield* Convex.Project("Project", {
      team: CONVEX_TEAM,
      name: CONVEX_PROJECT,
    }).pipe(Alchemy.RemovalPolicy.retain());
    const deployment = project.prodDeploymentName.as<string>();

    // Convex lists each key under its name plus a hash of the resource, such
    // as "workers-builds-3f2a1b0c9d8e". A key cannot change, so a changed prop
    // replaces it, and the Builds variables and the inbox wiring below take
    // the new secret. A replaced key made by alchemy-convex 0.1.x stays in
    // Convex with a warning: delete it in the Convex dashboard.
    //
    // The production key gets only what apps/mail/scripts/build-cloudflare.ts
    // and the inbox wiring need. Without allowedActions, Convex grants every
    // deployment action, including data writes and backup deletes.
    const deployKey = yield* Convex.DeployKey("DeployKey", {
      deployment,
      name: "workers-builds",
      allowedActions: [
        "deployment:deploy",
        "deployment:env:view",
        "deployment:env:write",
        "deployment:data:view",
      ],
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
