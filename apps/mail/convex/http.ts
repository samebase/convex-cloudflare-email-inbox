import { httpRouter } from "convex/server";
import { registerIngressRoutes } from "@samebase/convex-cloudflare-email-inbox/receiving";
import { components } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);
registerIngressRoutes(http, components.mail, {
  secret: () => process.env["MAIL_BRIDGE_SECRET"],
});

export default http;
