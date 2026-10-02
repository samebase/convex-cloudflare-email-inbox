import {
  createFunctionHandle,
  httpActionGeneric,
  type FunctionReference,
  type HttpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import {
  beginIngressRequest,
  beginIngressResponse,
  completeIngressRequest,
  completeIngressResponse,
} from "../component/mailProtocol.js";

export type MessageReceivedEvent = { messageId: string; inboxId: string; threadId: string };

export type IngressOptions = {
  secret: () => string | undefined;
  /** Runs after the message commits. A failed callback does not retry or remove the mail. */
  onMessageReceived?: FunctionReference<"action", "internal", MessageReceivedEvent, null>;
};

async function authorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const provided = request.headers.get("authorization");
  if (!provided) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`Bearer ${secret}`));
  return await crypto.subtle.verify("HMAC", key, signature, encoder.encode(provided));
}

async function readJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return { kind: "error" as const, status: 400 };
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteSize += chunk.value.byteLength;
      // Allow escaped JSON for the protocol's 512 KiB body plus MIME metadata.
      if (byteSize > 4 * 1_024 * 1_024) {
        await reader.cancel();
        return { kind: "error" as const, status: 413 };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(byteSize);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return { kind: "parsed" as const, value };
  } catch {
    return { kind: "error" as const, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

/** Mount these routes in the app's HTTP router, after its authentication routes. */
export function registerIngressRoutes(
  http: HttpRouter,
  component: ComponentApi,
  options: IngressOptions,
) {
  http.route({
    path: "/api/mail/ingress/begin",
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      if (!(await authorized(request, options.secret()))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const input = await readJson(request);
      if (input.kind === "error") {
        return Response.json({ error: "invalid_request" }, { status: input.status });
      }
      const parsed = beginIngressRequest.safeParse(input.value);
      if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
      const result = await ctx.runMutation(component.ingress.begin, {
        recipient: parsed.data.recipient,
        ingressKey: parsed.data.ingressKey,
        envelopeFrom: parsed.data.envelopeFrom,
        rawSize: parsed.data.rawSize,
        receivedAt: parsed.data.receivedAt,
      });
      return Response.json(beginIngressResponse.parse(result));
    }),
  });
  http.route({
    path: "/api/mail/ingress/complete",
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      if (!(await authorized(request, options.secret()))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const input = await readJson(request);
      if (input.kind === "error") {
        return Response.json({ error: "invalid_request" }, { status: input.status });
      }
      const parsed = completeIngressRequest.safeParse(input.value);
      if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
      const onMessageReceived = options.onMessageReceived
        ? await createFunctionHandle(options.onMessageReceived)
        : undefined;
      const result = await ctx.runMutation(component.ingress.complete, {
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
        ...(onMessageReceived ? { onMessageReceived } : {}),
      });
      return Response.json(completeIngressResponse.parse({ kind: result.kind }));
    }),
  });
}
