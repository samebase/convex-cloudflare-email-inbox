// Setup stack for Mail. It declares the Convex project, a production deploy
// key, and the inbox of the component
// (@samebase/convex-cloudflare-email-inbox/alchemy): the Worker that receives
// mail, which the component ships and Alchemy bundles here, its R2 bucket, and
// what that Worker and Convex must share. The app itself is served by its
// Convex deployment through @samebase/convex-hosting, and
// .github/workflows/deploy.yml deploys it.
//
// The stack owns wiring, not settings. A value that a person opens a
// dashboard to check (the owner email, the setup secret, the sending token)
// stays in that dashboard. The repository README lists them under "Setup
// stack".
//
// .github/workflows/infra.yml runs it: a plan and a drift report on every
// pull request that touches this file, a deploy on main. Run it from
// apps/mail. Locally it needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
// in apps/mail/.env (a user token with
// Workers Scripts, Workers R2 Storage, Secrets Store, Email Routing rules,
// Zone read, DNS) and the Convex CLI login:
//   npx alchemy plan --stage prod
//
// A fork changes the three values below.
import * as WorkersBuilds from "@samebase/alchemy-cloudflare-workers-builds";
import * as Convex from "@samebase/alchemy-convex";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox/alchemy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
      // No resource below uses it. The state still has the rows of the app
      // Worker and its Workers Builds link from before convex-hosting, and
      // Alchemy needs the provider of a row to remove it: the deploy deletes
      // the Builds link and drops the retained Worker from state, with the
      // Workers Builds Configuration permission on the token. Remove the
      // provider and its package once that deploy has run on main.
      WorkersBuilds.providers(),
      Convex.providers(),
    ),
    // State lives in the Cloudflare state store (an encrypted Durable Object in
    // the account), so the laptop and .github/workflows/infra.yml share it.
    state: Cloudflare.state(),
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
    const deployment = project.prodDeploymentName.as<string>();

    // Convex lists each key under its name plus a hash of the resource, such
    // as "workers-builds-3f2a1b0c9d8e". A key cannot change, so a changed prop
    // replaces it, and the inbox wiring below takes the new secret. A replaced
    // key made by alchemy-convex 0.1.x stays in Convex with a warning: delete
    // it in the Convex dashboard.
    //
    // The key was made for the Workers Builds deploys, hence its name and its
    // actions. Now only the inbox wiring uses it, to write two environment
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

    // Convex serves HTTP actions at the .convex.site twin of the deployment
    // URL. The inbox Worker posts inbound mail there, and the app is served
    // there too.
    const convexSiteUrl = project.prodDeploymentUrl.pipe(
      Output.map((url) => {
        if (!url) {
          throw new Error(`The Convex project ${CONVEX_PROJECT} has no production deployment.`);
        }
        return url.replace(/\.convex\.cloud$/, ".convex.site");
      }),
    );
    const inbox = yield* EmailInbox("Mail", {
      deployment,
      deployKey: deployKey.deployKey,
      convexSiteUrl,
      zone: MAIL_ZONE,
    });

    return { url: convexSiteUrl, inbox };
  }),
);
