import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { auth } from "./auth";
import {
  beginIngressRequest,
  beginIngressResponse,
  completeIngressRequest,
  completeIngressResponse,
} from "../shared/mailProtocol";

const http = httpRouter();

auth.addHttpRoutes(http);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function hasBridgeAccess(request: Request) {
  const secret = process.env["MAIL_BRIDGE_SECRET"];
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

http.route({
  path: "/api/mail/ingress/begin",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasBridgeAccess(request)) {
      return json({ error: "unauthorized" }, 401);
    }
    const parsed = beginIngressRequest.safeParse(await request.json());
    if (!parsed.success) {
      return json({ error: "invalid_request" }, 400);
    }
    const result = await ctx.runMutation(components.mail.ingress.begin, {
      recipient: parsed.data.recipient,
      ingressKey: parsed.data.ingressKey,
      envelopeFrom: parsed.data.envelopeFrom,
      rawSize: parsed.data.rawSize,
      receivedAt: parsed.data.receivedAt,
    });
    return json(beginIngressResponse.parse(result));
  }),
});

http.route({
  path: "/api/mail/ingress/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasBridgeAccess(request)) {
      return json({ error: "unauthorized" }, 401);
    }
    const parsed = completeIngressRequest.safeParse(await request.json());
    if (!parsed.success) {
      return json({ error: "invalid_request" }, 400);
    }
    const result = await ctx.runMutation(components.mail.ingress.complete, {
      recipient: parsed.data.recipient,
      ingressKey: parsed.data.ingressKey,
      parse: parsed.data.parse,
      headerFrom: parsed.data.headerFrom,
      replyToAddress: parsed.data.replyToAddress,
      headerTo: parsed.data.headerTo,
      headerCc: parsed.data.headerCc,
      rfcMessageId: parsed.data.rfcMessageId,
      inReplyTo: parsed.data.inReplyTo,
      references: parsed.data.references,
      subject: parsed.data.subject,
      snippet: parsed.data.snippet,
      occurredAt: parsed.data.occurredAt,
      bodies: parsed.data.bodies,
      attachments: parsed.data.attachments,
    });
    return json(completeIngressResponse.parse({ kind: result.kind }));
  }),
});

export default http;
