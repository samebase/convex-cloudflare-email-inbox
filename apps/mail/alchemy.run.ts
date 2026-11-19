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
// The 0.2.0 Project. Its providers also read the state rows of the old deploy
// key and the four old EnvironmentVariable resources. They have
// RemovalPolicy.retain in state, so this deploy drops the rows and leaves the
// key and the variables in Convex. The next change moves Project to 0.41.0.
import * as Convex from "@samebase/alchemy-convex-resources";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox/alchemy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
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
    const required = (value: string | undefined) =>
      value === undefined
        ? Effect.die(new Error(`Convex project ${CONVEX_PROJECT} has no production deployment.`))
        : Effect.succeed(value);
    const convexSiteUrl = project.prodDeploymentUrl.pipe(
      Output.mapEffect((url) =>
        required(url).pipe(
          Effect.map((found) => found.replace(/\.convex\.cloud$/, ".convex.site")),
        ),
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

    // Tells Samebase that the installed component "mail" owns the Mail namespace.
    yield* bindComponent({
      deployment: production,
      component: "mail",
      namespace: inbox.worker.Namespace,
    });

    return { url: convexSiteUrl, inbox: { workerUrl: inbox.worker.url } };
  }),
);
