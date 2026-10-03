import { v } from "convex/values";
import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import { inboxView } from "@samebase/convex-cloudflare-email-inbox/monitor";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";

const email = new EmailInbox(components.mail);

export const list = query({
  args: {},
  returns: v.array(inboxView),
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await email.listInboxes(ctx);
  },
});

export const create = mutation({
  args: { domain: v.string(), localPart: v.string(), label: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await email.createInbox(ctx, {
      address: `${args.localPart.trim()}@${args.domain.trim()}`,
      label: args.label,
    });
  },
});
