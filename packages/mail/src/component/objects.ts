import { v } from "convex/values";
import { query } from "./_generated/server";

const objectReference = v.union(
  v.object({ kind: v.literal("raw"), messageId: v.id("emailMessages") }),
  v.object({ kind: v.literal("attachment"), attachmentId: v.id("emailAttachments") }),
);

const objectDescriptor = v.object({
  r2Key: v.string(),
  filename: v.string(),
  contentType: v.string(),
});

export const resolve = query({
  args: { object: objectReference },
  returns: v.union(v.null(), objectDescriptor),
  handler: async (ctx, { object }) => {
    if (object.kind === "attachment") {
      const attachment = await ctx.db.get(object.attachmentId);
      if (!attachment) {
        return null;
      }
      return {
        r2Key: attachment.r2Key,
        filename: attachment.originalFilename,
        contentType: attachment.mimeType,
      };
    }
    const message = await ctx.db.get(object.messageId);
    if (!message || message.transport.kind !== "inbound") {
      return null;
    }
    const safeSubject = message.subject
      .replace(/[^a-zA-Z0-9._ -]+/g, "")
      .trim()
      .slice(0, 100);
    return {
      r2Key: message.transport.rawR2Key,
      filename: `${safeSubject || "message"}.eml`,
      contentType: "message/rfc822",
    };
  },
});
