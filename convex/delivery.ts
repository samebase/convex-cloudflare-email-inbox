import { v } from "convex/values";
import { sendMailResponse } from "./components/mail/mailProtocol";
import { components } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const send = internalAction({
  args: { messageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const payload = await ctx.runMutation(components.mail.delivery.claim, { messageId });
    if (!payload) {
      return null;
    }
    const workerUrl = process.env["MAIL_WORKER_URL"];
    const secret = process.env["MAIL_BRIDGE_SECRET"];
    if (!workerUrl || !secret) {
      await ctx.runMutation(components.mail.delivery.finish, {
        messageId,
        outcome: { kind: "unknown" },
      });
      return null;
    }
    try {
      const response = await fetch(`${workerUrl.replace(/\/$/, "")}/api/mail/send`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ version: 1, ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = sendMailResponse.safeParse(await response.json());
      if (!result.success) {
        throw new Error("Mail bridge returned an invalid response");
      }
      await ctx.runMutation(components.mail.delivery.finish, {
        messageId,
        outcome: result.data,
      });
    } catch {
      await ctx.runMutation(components.mail.delivery.finish, {
        messageId,
        outcome: { kind: "unknown" },
      });
    }
    return null;
  },
});
