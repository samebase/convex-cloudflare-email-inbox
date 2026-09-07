import { v } from "convex/values";
import { normalizeMailAddress } from "../shared/mailProtocol";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";

const inboxSummary = v.object({
  _id: v.id("inboxes"),
  address: v.string(),
  label: v.string(),
  localPart: v.string(),
  unreadCount: v.number(),
});

function normalizeLocalPart(value: string) {
  const localPart = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(localPart)) {
    throw new Error("Use a valid inbox name");
  }
  return localPart;
}

function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("Use a valid domain");
  }
  return domain;
}

export const list = query({
  args: {},
  returns: v.array(inboxSummary),
  handler: async (ctx) => {
    await requireOwner(ctx);
    const inboxes = await ctx.db.query("inboxes").withIndex("by_created_at").take(100);
    return inboxes.map((inbox) => ({
      _id: inbox._id,
      address: inbox.address,
      label: inbox.label,
      localPart: inbox.localPart,
      unreadCount: inbox.unreadCount,
    }));
  },
});

export const create = mutation({
  args: { domain: v.string(), localPart: v.string(), label: v.string() },
  returns: v.id("inboxes"),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const domain = normalizeDomain(args.domain);
    const localPart = normalizeLocalPart(args.localPart);
    const address = normalizeMailAddress(`${localPart}@${domain}`);
    const existingInbox = await ctx.db
      .query("inboxes")
      .withIndex("by_address", (q) => q.eq("address", address))
      .unique();
    if (existingInbox) {
      throw new Error("This inbox already exists");
    }

    let domainRow = await ctx.db
      .query("mailDomains")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    if (!domainRow) {
      const domainId = await ctx.db.insert("mailDomains", {
        domain,
        createdAt: Date.now(),
      });
      domainRow = await ctx.db.get(domainId);
    }
    if (!domainRow) {
      throw new Error("Could not create domain");
    }

    return await ctx.db.insert("inboxes", {
      domainId: domainRow._id,
      localPart,
      address,
      label: args.label.trim() || localPart,
      unreadCount: 0,
      createdAt: Date.now(),
    });
  },
});
