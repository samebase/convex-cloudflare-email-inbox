import { downloadObject, receiveEmail } from "@samebase/convex-cloudflare-email-inbox/worker";

// The deploy scripts set CONVEX_SITE_URL, and the setup stack sets the two secrets.
type MailEnv = Env & {
  CONVEX_SITE_URL: string;
  MAIL_BRIDGE_SECRET: string;
  MAIL_RECOVERY_ADDRESS: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/mail/object") {
      return await downloadObject(request, env);
    }
    return await env.ASSETS.fetch(request);
  },
  async email(message, env) {
    try {
      await receiveEmail(message, env);
    } catch {
      if (env.MAIL_RECOVERY_ADDRESS) {
        try {
          await message.forward(env.MAIL_RECOVERY_ADDRESS);
          return;
        } catch {
          message.setReject("Mail storage is temporarily unavailable");
          return;
        }
      }
      message.setReject("Mail storage is temporarily unavailable");
    }
  },
} satisfies ExportedHandler<MailEnv>;
