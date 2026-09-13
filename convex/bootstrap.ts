import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const defaultInboxes = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    return await ctx.runMutation(components.mail.bootstrap.ensureInboxes, {
      domain: "json.md",
      inboxes: [
        { localPart: "inbox", label: "Inbox" },
        { localPart: "notes", label: "Notes" },
      ],
    });
  },
});
