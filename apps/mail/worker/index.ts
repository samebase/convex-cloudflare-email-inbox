import { verifyObjectGrant } from "../shared/objectGrant";
import { receiveEmail } from "./inbound";

type MailEnv = Env & { MAIL_BRIDGE_SECRET: string; MAIL_RECOVERY_ADDRESS: string };

async function downloadObject(request: Request, env: MailEnv) {
  const grant = new URL(request.url).searchParams.get("grant");
  if (!grant) return new Response("Not found", { status: 404 });
  if (!env.MAIL_BRIDGE_SECRET) return new Response("Service unavailable", { status: 503 });
  const payload = await verifyObjectGrant(grant, env.MAIL_BRIDGE_SECRET);
  if (!payload) return new Response("Not found", { status: 404 });
  const object = await env.MAIL_STORAGE.get(payload.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  const filename = payload.filename.replace(/[\r\n]/g, " ");
  return new Response(object.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "content-type": payload.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}

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
