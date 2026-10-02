import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("mail", {
  env: {
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
    MAIL_WORKER_URL: v.optional(v.string()),
    MAIL_BRIDGE_SECRET: v.optional(v.string()),
  },
});
