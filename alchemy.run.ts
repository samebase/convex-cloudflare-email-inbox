// Setup stack for Mail. It declares what already exists and keeps Workers
// Builds as the deployer: the Worker shell, its Builds link to this
// repository, the Convex deploy keys the builds use, the mail storage, and
// the inbound routing on json.md. It never uploads Worker code;
// apps/mail/wrangler.jsonc stays the source of truth for that.
//
// Run locally with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env (a
// user token with Workers Scripts, Workers Builds Configuration, R2, Email
// Routing rules and addresses, Zone read, DNS) and the Convex CLI login:
//   npx alchemy deploy --adopt
//
// The buckets are retained on destroy: a destroy removes them from state and
// leaves the mail in place.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const WORKER_NAME = "samebase-mail";
/** json.md */
const ZONE_ID = "ac816f257bd126fb7628aaa77e92cff9";
const CONVEX_TEAM_ID = 38516;
const CONVEX_PROJECT_ID = 2948601;
const CONVEX_PROD_DEPLOYMENT = "sensible-porcupine-30";

// Samebase reads this build variable to link the Worker to its Convex
// project in the dashboard. Same format Samebase writes itself.
const SAMEBASE_CONVEX_PROJECT = `version=1&teamId=${CONVEX_TEAM_ID}&projectId=${CONVEX_PROJECT_ID}`;

export default Alchemy.Stack(
  "SamebaseMail",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      WorkersBuilds.providers(),
      Convex.providers(),
    ),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    // Only the name: every other Worker setting stays with wrangler.jsonc.
    const worker = yield* WorkersBuilds.Worker("Worker", { name: WORKER_NAME });

    const deployKey = yield* Convex.DeployKey("DeployKey", {
      deployment: CONVEX_PROD_DEPLOYMENT,
      name: "workers-builds",
    });
    const previewKey = yield* Convex.PreviewDeployKey("PreviewDeployKey", {
      projectId: CONVEX_PROJECT_ID,
      name: "workers-builds",
    });

    const builds = yield* WorkersBuilds.Repository("Builds", {
      worker: worker.workerId,
      repository: {
        owner: "samebase",
        name: "mail",
        branch: "main",
        ownerId: 285392744,
        repositoryId: 1359645902,
      },
      buildCommand: "pnpm run build",
      deployCommand: "pnpm run deploy",
      previewDeployCommand: "pnpm run deploy:preview",
      buildCachingEnabled: false,
      // apps/mail/scripts/build-cloudflare.ts reads CONVEX_DEPLOY_KEY: the
      // production key on main, the project preview key on other branches.
      variables: {
        CONVEX_DEPLOY_KEY: deployKey.deployKey,
        SAMEBASE_CONVEX_PROJECT,
      },
      previewVariables: { CONVEX_DEPLOY_KEY: previewKey.previewDeployKey },
    });

    // Mail storage, bound as MAIL_STORAGE in wrangler.jsonc.
    yield* Cloudflare.R2.Bucket("Storage", { name: "samebase-mail" }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );
    yield* Cloudflare.R2.Bucket("PreviewStorage", { name: "samebase-mail-previews" }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );

    // Inbound mail for json.md goes to the Worker. Email Routing itself stays
    // enabled from the dashboard: Alchemy's Routing resource calls the enable
    // endpoint on every create, and Cloudflare does not document that call on
    // a zone that is already enabled.
    yield* Cloudflare.Email.CatchAll("CatchAll", {
      zone: ZONE_ID,
      name: "samebase-mail catch-all",
      enabled: true,
      actions: [{ type: "worker", value: [WORKER_NAME] }],
    });

    return { url: worker.url, previewsEnabled: builds.previewsEnabled };
  }),
);
