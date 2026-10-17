import { httpRouter } from "convex/server";
import { registerIngressRoutes } from "@samebase/convex-cloudflare-email-inbox/receiving";
import { routeAll } from "@samebase/convex-hosting";
import { versionId } from "../.convex-hosting/version.js";
import { components } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);
registerIngressRoutes(http, components.mail, {
  secret: () => process.env["MAIL_BRIDGE_SECRET"],
});
// The site answers every other request: one "/" prefix route per method. Convex's router picks
// exact paths and longer prefixes first, so the auth and ingress routes above keep their requests.
routeAll(http, components.hosting, versionId);

export default http;
