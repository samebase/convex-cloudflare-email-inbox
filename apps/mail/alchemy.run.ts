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
import { bindComponent, Deployment, providers, state } from "@samebase/alchemy-convex";
// These resources still own the existing key and environment variables.
import * as Convex from "@samebase/alchemy-convex-resources";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox/alchemy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Provider from "alchemy/Provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The team id, not the slug: CI authenticates with a team access token, and
// Convex answers the slug lookup only for a user login.
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
    // Samebase reads this team's alchemy-state project and the repository's run record.
    state: state({ team: CONVEX_TEAM }),
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
    // The existing deployment has code, so adoption is explicit. Hosting still deploys it.
    const production = yield* Deployment("Deployment", {
      project: { projectId: project.projectId },
      type: "prod",
    }).pipe(Alchemy.AdoptPolicy.adopt());
    const deployment = production.name;

    // Convex lists each key under its name plus a hash of the resource, such
    // as "workers-builds-3f2a1b0c9d8e". A key cannot change, so a changed prop
    // replaces it, and the inbox wiring below takes the new secret. A replaced
    // key made by alchemy-convex 0.1.x stays in Convex with a warning: delete
    // it in the Convex dashboard.
    //
    // The key was made for the Workers Builds deploys, hence its name and its
    // actions. Now only the inbox wiring uses it, to write four environment
    // variables. Without allowedActions, Convex grants every deployment
    // action, including data writes and backup deletes.
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

    const convexSiteUrl = production.siteUrl;
    const inbox = yield* EmailInbox("Mail", {
      convexSiteUrl,
      zone: MAIL_ZONE,
      sendingDomain: MAIL_ZONE,
    });
    // Tells Samebase that the installed component "mail" owns the Mail namespace.
    yield* bindComponent({
      deployment: production,
      component: "mail",
      namespace: inbox.worker.Namespace,
    });

    // Preserve the existing environment resource IDs while the app owns the
    // connection to Convex. convex.config.ts passes these values to components.mail.
    yield* Namespace.push(
      "Mail",
      Effect.gen(function* () {
        yield* Convex.EnvironmentVariable("ConvexBridgeSecret", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "MAIL_BRIDGE_SECRET",
          value: inbox.env.MAIL_BRIDGE_SECRET,
        });
        yield* Convex.EnvironmentVariable("ConvexWorkerUrl", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "MAIL_WORKER_URL",
          value: inbox.env.MAIL_WORKER_URL,
        });
        yield* Convex.EnvironmentVariable("ConvexSendingToken", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "CLOUDFLARE_EMAIL_API_TOKEN",
          value: inbox.env.CLOUDFLARE_EMAIL_API_TOKEN,
        });
        yield* Convex.EnvironmentVariable("ConvexSendingAccount", {
          deployment,
          deployKey: deployKey.deployKey,
          name: "CLOUDFLARE_EMAIL_ACCOUNT_ID",
          value: inbox.env.CLOUDFLARE_EMAIL_ACCOUNT_ID,
        });
      }),
    );

    return { url: convexSiteUrl, inbox: { workerUrl: inbox.worker.url } };
  }),
);
