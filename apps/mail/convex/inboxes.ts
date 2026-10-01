import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";

const inboxSummary = v.object({
  _id: v.string(),
  address: v.string(),
  label: v.string(),
  localPart: v.string(),
  unreadCount: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(inboxSummary),
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.runQuery(components.mail.inboxes.list, {});
  },
});

export const create = mutation({
  args: { domain: v.string(), localPart: v.string(), label: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await ctx.runMutation(components.mail.inboxes.create, {
      domain: args.domain,
      localPart: args.localPart,
      label: args.label,
    });
  },
});
