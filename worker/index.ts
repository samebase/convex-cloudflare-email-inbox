import { sendMailRequest, sendMailResponse } from "../shared/mailProtocol";
import { verifyObjectGrant } from "../shared/objectGrant";
import { receiveEmail } from "./inbound";

type MailEnv = Env & { MAIL_BRIDGE_SECRET: string; MAIL_RECOVERY_ADDRESS: string };
const encoder = new TextEncoder();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function hasBridgeAccess(request: Request, env: MailEnv) {
  return Boolean(
    env.MAIL_BRIDGE_SECRET &&
    request.headers.get("authorization") === `Bearer ${env.MAIL_BRIDGE_SECRET}`,
  );
}

function safeMessageId(value: string | null) {
  if (!value || /[\r\n]/.test(value)) {
    return null;
  }
  const normalized = value.trim();
  return normalized && encoder.encode(normalized).byteLength <= 2_048 ? normalized : null;
}

function safeReferences(values: string[]) {
  const selected: string[] = [];
  let byteLength = 0;
  for (const value of values.toReversed()) {
    const messageId = safeMessageId(value);
    if (!messageId) {
      continue;
    }
    const nextLength = encoder.encode(messageId).byteLength + (selected.length > 0 ? 1 : 0);
    if (byteLength + nextLength > 2_048) {
      continue;
    }
    selected.unshift(messageId);
    byteLength += nextLength;
  }
  return selected.join(" ");
}

async function sendMail(request: Request, env: MailEnv) {
  if (!env.MAIL_BRIDGE_SECRET) {
    return json({ error: "service_unavailable" }, 503);
  }
  if (!hasBridgeAccess(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  const parsed = sendMailRequest.safeParse(await request.json());
  if (!parsed.success) {
    return json(sendMailResponse.parse({ kind: "rejected", code: "invalid_request" }), 400);
  }
  const headers: Record<string, string> = {};
  const inReplyTo = safeMessageId(parsed.data.inReplyTo);
  if (inReplyTo) {
    headers["In-Reply-To"] = inReplyTo;
  }
  const references = safeReferences(parsed.data.references);
  if (references) {
    headers["References"] = references;
  }
  try {
    const result = await env.EMAIL.send({
      from: parsed.data.from,
      to: parsed.data.to,
      ...(parsed.data.cc.length > 0 ? { cc: parsed.data.cc } : {}),
      subject: parsed.data.subject,
      text: parsed.data.text,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
    return json(sendMailResponse.parse({ kind: "accepted", providerMessageId: result.messageId }));
  } catch {
    return json({ error: "provider_error" }, 502);
  }
}

async function downloadObject(request: Request, env: MailEnv) {
  const grant = new URL(request.url).searchParams.get("grant");
  if (!grant) {
    return new Response("Not found", { status: 404 });
  }
  if (!env.MAIL_BRIDGE_SECRET) {
    return new Response("Service unavailable", { status: 503 });
  }
  const payload = await verifyObjectGrant(grant, env.MAIL_BRIDGE_SECRET);
  if (!payload) {
    return new Response("Not found", { status: 404 });
  }
  const object = await env.MAIL_STORAGE.get(payload.r2Key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }
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
    if (request.method === "POST" && url.pathname === "/api/mail/send") {
      return await sendMail(request, env);
    }
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
