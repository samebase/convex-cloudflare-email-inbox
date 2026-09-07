import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

export const defaultInboxes = internalMutation({
  args: {},
  returns: v.array(v.id("inboxes")),
  handler: async (ctx) => {
    const domainName = "json.md";
    let domain = await ctx.db
      .query("mailDomains")
      .withIndex("by_domain", (q) => q.eq("domain", domainName))
      .unique();
    if (!domain) {
      const domainId = await ctx.db.insert("mailDomains", {
        domain: domainName,
        createdAt: Date.now(),
      });
      domain = await ctx.db.get(domainId);
    }
    if (!domain) {
      throw new Error("Could not create default domain");
    }
    const inboxIds: Id<"inboxes">[] = [];
    for (const localPart of ["inbox", "notes"]) {
      const address = `${localPart}@${domainName}`;
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
          localPart,
          address,
          label: localPart[0]?.toUpperCase() + localPart.slice(1),
          unreadCount: 0,
          createdAt: Date.now(),
        }),
      );
    }
    return inboxIds;
  },
});
