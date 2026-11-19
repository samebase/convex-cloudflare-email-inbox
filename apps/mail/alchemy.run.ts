// Setup stack for Mail. It declares the Convex project, its production deployment,
// a deploy key, and the inbox of the component
// (@samebase/convex-cloudflare-email-inbox/alchemy): the Worker that receives
// mail, which the component ships and Alchemy bundles here, its R2 bucket,
// its sending domain and token, and the values that Worker and Convex share.
// The app is served by its Convex deployment through @samebase/convex-hosting, and
// .github/workflows/deploy.yml deploys it.
//
// Owner email and sign-up settings stay in the Convex dashboard. The stack
// creates sending credentials and writes the component's environment values.
//
// .github/workflows/infra.yml runs it: a plan and a drift report on every
// pull request that touches this file, a deploy on main. Run it from
// apps/mail. Locally it needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
// in apps/mail/.env (a user token with
// Workers Scripts, Workers R2 Storage, Secrets Store, Email Routing rules,
// Zone read, DNS, Email Sending, Account API Tokens) and the Convex CLI login:
//   npx alchemy plan --stage prod
//
// A fork changes the three values below.
import {
  bindComponent,
  Deployment,
  providers,
  state,
  withRunRecord,
} from "@samebase/alchemy-convex";
// The 0.2.0 resources: Project, and the key and variables that leave in step 2 (see below).
import * as Convex from "@samebase/alchemy-convex-resources";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox/alchemy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import * as Provider from "alchemy/Provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The team id, not the slug: CI authenticates with a team access token, and
// Convex answers the slug lookup only for a user login. Only the project from
// the 0.2.0 alias takes it; the state uses the team of the credential.
const CONVEX_TEAM = 38516;
const CONVEX_PROJECT = "mail";
const MAIL_ZONE = "json.md";

export default Alchemy.Stack(
  "samebase/convex-cloudflare-email-inbox/apps/mail",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Convex.providers(),
      // Both releases use the Convex collection key. Add only the modern deployment provider.
      Provider.effect(Deployment, Provider.findProvider(Deployment)).pipe(
        Layer.provide(providers()),
      ),
    ),
    // Samebase reads the credential's team's alchemy-state project and the run record.
    state: withRunRecord(state()),
  },
  Effect.gen(function* () {
    // Found by name when it has no state, then by id. A delete of the
    // project deletes all of its deployments and data. Convex.Project
    // retains by default since alchemy-convex 0.2.0; the explicit retain
    // keeps that visible here.
    const project = yield* Convex.Project("Project", {
      team: CONVEX_TEAM,
      name: CONVEX_PROJECT,
    }).pipe(Alchemy.RemovalPolicy.retain());

    // The inbox Worker calls the site URL of the production deployment. It
    // comes from the project, not from the deployment, because the deployment
    // takes its env from the inbox. The rule is the one of Convex.Deployment:
    // https://<name>[.<region>].convex.cloud serves the site on .convex.site.
    const convexSiteUrl = project.prodDeploymentUrl.pipe(
      Output.mapEffect((url) =>
        url === undefined
          ? Effect.die(new Error(`Convex project ${CONVEX_PROJECT} has no production deployment.`))
          : Effect.succeed(url.replace(/\.convex\.cloud$/, ".convex.site")),
      ),
    );
    const inbox = yield* EmailInbox("Mail", {
      convexSiteUrl,
      zone: MAIL_ZONE,
      sendingDomain: MAIL_ZONE,
    });

    // The existing deployment has code, so adoption is explicit. Hosting
    // deploys the code. The stack sets the four values that convex.config.ts
    // passes to components.mail. The variables exist with the same values, so
    // the deployment takes them over without --adopt.
    const production = yield* Deployment("Deployment", {
      project: { projectId: project.projectId },
      type: "prod",
      env: {
        MAIL_BRIDGE_SECRET: inbox.env.MAIL_BRIDGE_SECRET,
        MAIL_WORKER_URL: inbox.env.MAIL_WORKER_URL,
        CLOUDFLARE_EMAIL_API_TOKEN: inbox.env.CLOUDFLARE_EMAIL_API_TOKEN,
        CLOUDFLARE_EMAIL_ACCOUNT_ID: inbox.env.CLOUDFLARE_EMAIL_ACCOUNT_ID,
      },
    }).pipe(Alchemy.AdoptPolicy.adopt());
    const deployment = production.name;

    // Step 1 of the move off the alchemy-convex 0.2.0 resources. The deploy
    // key and the four EnvironmentVariable resources below now only record
    // RemovalPolicy.retain in state. The next change removes them from this
    // file: Alchemy then drops them from state and leaves the key and the
    // variables in Convex, where Deployment owns the variables. The key was
    // made for the old Workers Builds deploys and keeps its name.
    const deployKey = yield* Convex.DeployKey("DeployKey", {
      deployment,
      name: "workers-builds",
      allowedActions: [
        "deployment:deploy",
        "deployment:env:view",
        "deployment:env:write",
        "deployment:data:view",
      ],
    }).pipe(Alchemy.RemovalPolicy.retain());
    // Tells Samebase that the installed component "mail" owns the Mail namespace.
    yield* bindComponent({
      deployment: production,
      component: "mail",
      namespace: inbox.worker.Namespace,
    });

    yield* Namespace.push(
      "Mail",
      Effect.gen(function* () {
        yield* Convex.EnvironmentVariable("ConvexBridgeSecret", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "MAIL_BRIDGE_SECRET",
          value: inbox.env.MAIL_BRIDGE_SECRET,
        }).pipe(Alchemy.RemovalPolicy.retain());
        yield* Convex.EnvironmentVariable("ConvexWorkerUrl", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "MAIL_WORKER_URL",
          value: inbox.env.MAIL_WORKER_URL,
        }).pipe(Alchemy.RemovalPolicy.retain());
        yield* Convex.EnvironmentVariable("ConvexSendingToken", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "CLOUDFLARE_EMAIL_API_TOKEN",
          value: inbox.env.CLOUDFLARE_EMAIL_API_TOKEN,
        }).pipe(Alchemy.RemovalPolicy.retain());
        yield* Convex.EnvironmentVariable("ConvexSendingAccount", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "CLOUDFLARE_EMAIL_ACCOUNT_ID",
          value: inbox.env.CLOUDFLARE_EMAIL_ACCOUNT_ID,
        }).pipe(Alchemy.RemovalPolicy.retain());
      }),
    );

    return { url: convexSiteUrl, inbox: { workerUrl: inbox.worker.url } };
  }),
);
