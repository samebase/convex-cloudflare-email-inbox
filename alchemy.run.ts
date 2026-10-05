// Setup stack for Mail. It declares the full install around Workers Builds:
// the Worker shell and its secrets, the Builds link to this repository, the
// Convex project with its deploy keys and variables, the mail storage, and
// the inbound routing on the mail zone. It never uploads Worker code;
// apps/mail/wrangler.jsonc stays the source of truth for that.
//
// The file holds no ids of one install. The stack name gives the app name
// (SamebaseMail gives samebase-mail), and the inputs below give the rest.
// The inputs come from the environment or .env locally, and from repository
// secrets and variables in .github/workflows/infra.yml. The "Setup stack"
// section of README.md lists them, with the manual steps of a new install.
// The Convex CLI login or CONVEX_ACCESS_TOKEN authenticates Convex.
//   npx alchemy plan --stage prod
//
// The Worker, the Convex project, the buckets, the recovery address, and the
// catch-all rule are retained on destroy: a destroy removes them from state
// and keeps the app and its mail in place.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

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
    const stack = yield* Alchemy.Stack;
    // SamebaseMail gives samebase-mail on prod and samebase-mail-<stage> on other stages.
    const app =
      stack.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() +
      (stack.stage === "prod" ? "" : `-${stack.stage}`);

    const convexTeam = yield* Config.String("CONVEX_TEAM");
    const convexProject = yield* Config.String("CONVEX_PROJECT").pipe(Config.withDefault(app));
    const mailZone = yield* Config.String("MAIL_ZONE");
    const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID");
    const ownerEmail = yield* Config.String("OWNER_EMAIL");
    const ownerSetupSecret = yield* Config.Redacted("OWNER_SETUP_SECRET");
    const recoveryAddress = yield* Config.Redacted("MAIL_RECOVERY_ADDRESS");
    const emailApiToken = yield* Config.Redacted("CLOUDFLARE_EMAIL_API_TOKEN");

    // The GitHub repository of this clone, or GITHUB_REPOSITORY in Actions.
    const repository = yield* WorkersBuilds.currentRepository.pipe(Effect.orDie);

    // Only the name: every other Worker setting stays with wrangler.jsonc.
    const worker = yield* WorkersBuilds.Worker("Worker", { name: app }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );

    // A delete of the project deletes all of its deployments and data, and
    // each change of its props is a replacement. Retain it.
    const project = yield* Convex.Project("Project", {
      team: convexTeam,
      name: convexProject,
    }).pipe(Alchemy.RemovalPolicy.retain());
    const prodDeployment = project.prodDeploymentName.as<string>();

    const deployKey = yield* Convex.DeployKey("DeployKey", {
      deployment: prodDeployment,
      name: "workers-builds",
    });
    const previewKey = yield* Convex.PreviewDeployKey("PreviewDeployKey", {
      projectId: project.projectId,
      name: "workers-builds",
    });

    const builds = yield* WorkersBuilds.Repository("Builds", {
      worker: worker.workerId,
      repository: {
        owner: repository.owner,
        name: repository.name,
        branch: repository.defaultBranch,
        ownerId: repository.ownerId,
        repositoryId: repository.repositoryId,
      },
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

    // The Worker and Convex production authenticate each other with this
    // secret, and Convex signs download links with it. Alchemy makes it once
    // and keeps it in state. Preview Worker versions get a different secret
    // from the preview settings of the Worker, which this stack does not set.
    const bridgeSecret = yield* Alchemy.Random("BridgeSecret");
    yield* WorkersBuilds.Secret("WorkerBridgeSecret", {
      worker: worker.name,
      name: "MAIL_BRIDGE_SECRET",
      value: bridgeSecret.text,
    });
    yield* WorkersBuilds.Secret("WorkerRecoveryAddress", {
      worker: worker.name,
      name: "MAIL_RECOVERY_ADDRESS",
      value: recoveryAddress,
    });

    // Email Routing sends mail only to a verified destination. On a new
    // install, Cloudflare sends a verification mail to this address.
    yield* Cloudflare.Email.Address("RecoveryAddress", {
      email: Redacted.value(recoveryAddress),
    }).pipe(Alchemy.RemovalPolicy.retain());

    // wrangler.jsonc names no route, so the Worker serves only on workers.dev.
    // The URL is undefined when the account has no workers.dev subdomain yet.
    const workerUrl = worker.url.pipe(
      Output.mapEffect((url) =>
        url === undefined
          ? Effect.die(new Error("Set the workers.dev subdomain of the Cloudflare account."))
          : Effect.succeed(url),
      ),
    );

    const production = {
      OWNER_EMAIL: ownerEmail,
      OWNER_SETUP_SECRET: ownerSetupSecret,
      MAIL_BRIDGE_SECRET: bridgeSecret.text,
      MAIL_WORKER_URL: workerUrl,
      CLOUDFLARE_EMAIL_API_TOKEN: emailApiToken,
      CLOUDFLARE_EMAIL_ACCOUNT_ID: accountId,
    };
    for (const [name, value] of Object.entries(production)) {
      yield* Convex.EnvironmentVariable(`Production${name}`, {
        deployment: prodDeployment,
        deployKey: deployKey.deployKey,
        name,
        value,
      });
    }

    // Each new preview deployment gets these. Previews do not get the sending
    // token, so a preview cannot send real mail. The preview MAIL_BRIDGE_SECRET
    // must match the preview Worker secret, so it is set by hand in both places.
    const preview = {
      OWNER_EMAIL: ownerEmail,
      OWNER_SETUP_SECRET: ownerSetupSecret,
      CLOUDFLARE_EMAIL_ACCOUNT_ID: accountId,
    };
    for (const [name, value] of Object.entries(preview)) {
      yield* Convex.DefaultEnvironmentVariable(`Preview${name}`, {
        projectId: project.projectId,
        name,
        value,
        deploymentType: "preview",
      });
    }

    // Mail storage, bound as MAIL_STORAGE in wrangler.jsonc.
    yield* Cloudflare.R2.Bucket("Storage", { name: app }).pipe(Alchemy.RemovalPolicy.retain());
    yield* Cloudflare.R2.Bucket("PreviewStorage", { name: `${app}-previews` }).pipe(
      Alchemy.RemovalPolicy.retain(),
    );

    // Inbound mail for the zone goes to the Worker. Email Routing itself stays
    // enabled from the dashboard: Alchemy's Routing resource calls the enable
    // endpoint on every create, and Cloudflare does not document that call on
    // a zone that is already enabled.
    yield* Cloudflare.Email.CatchAll("CatchAll", {
      zone: mailZone,
      name: `${app} catch-all`,
      enabled: true,
      actions: [{ type: "worker", value: [worker.name] }],
    }).pipe(Alchemy.RemovalPolicy.retain());

    return { url: worker.url, previewsEnabled: builds.previewsEnabled };
  }),
);
