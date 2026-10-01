import { defineApp } from "convex/server";
import mail from "@samebase/convex-cloudflare-email-inbox/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
  },
});

app.use(mail, {
  env: {
    CLOUDFLARE_EMAIL_API_TOKEN: app.env.CLOUDFLARE_EMAIL_API_TOKEN,
    CLOUDFLARE_EMAIL_ACCOUNT_ID: app.env.CLOUDFLARE_EMAIL_ACCOUNT_ID,
  },
});

export default app;
