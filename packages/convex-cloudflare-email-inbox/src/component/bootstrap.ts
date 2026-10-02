import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";

export const ensureInboxes = mutation({
  args: {
    domain: v.string(),
    inboxes: v.array(v.object({ localPart: v.string(), label: v.string() })),
  },
  returns: v.array(v.id("inboxes")),
  handler: async (ctx, args) => {
    let domain = await ctx.db
      .query("mailDomains")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .unique();
    if (!domain) {
      const domainId = await ctx.db.insert("mailDomains", {
        domain: args.domain,
        createdAt: Date.now(),
      });
      domain = await ctx.db.get(domainId);
    }
    if (!domain) {
      throw new Error("Could not create default domain");
    }
    const inboxIds: Id<"inboxes">[] = [];
    for (const requestedInbox of args.inboxes) {
      const address = `${requestedInbox.localPart}@${args.domain}`;
      const existing = await ctx.db
        .query("inboxes")
        .withIndex("by_address", (q) => q.eq("address", address))
        .unique();
      if (existing) {
        inboxIds.push(existing._id);
        continue;
      }
      inboxIds.push(
        await ctx.db.insert("inboxes", {
          domainId: domain._id,
          localPart: requestedInbox.localPart,
          address,
          label: requestedInbox.label,
          unreadCount: 0,
          createdAt: Date.now(),
        }),
      );
    }
    return inboxIds;
  },
});
