import { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import {
  deliveryView,
  historyPage,
  inboxView,
  listHistoryArgs,
  messageView,
} from "@samebase/convex-cloudflare-email-inbox/monitor";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { requireOwner } from "./access";

const email = new EmailInbox(components.mail);

export const listInboxes = query({
  args: {},
  returns: v.array(inboxView),
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await email.listInboxes(ctx);
  },
});

export const listHistory = query({
  args: listHistoryArgs,
  returns: historyPage,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await email.listHistory(ctx, {
      inboxId: args.inboxId,
      status: args.status,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const getMessage = query({
  args: { messageId: v.string() },
  returns: v.union(v.null(), messageView),
  handler: async (ctx, { messageId }) => {
    await requireOwner(ctx);
    return await email.getMessage(ctx, { messageId });
  },
});

export const getDelivery = query({
  args: { messageId: v.string() },
  returns: deliveryView,
  handler: async (ctx, { messageId }) => {
    await requireOwner(ctx);
    return await email.getDelivery(ctx, { messageId });
  },
});
