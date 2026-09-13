import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { createObjectGrant } from "../shared/objectGrant";

const objectReference = v.union(
  v.object({ kind: v.literal("raw"), messageId: v.string() }),
  v.object({ kind: v.literal("attachment"), attachmentId: v.string() }),
);

const objectDescriptor = v.object({
  r2Key: v.string(),
  filename: v.string(),
  contentType: v.string(),
});

export const resolve = internalQuery({
  args: { userId: v.id("users"), object: objectReference },
  returns: v.union(v.null(), objectDescriptor),
  handler: async (ctx, { userId, object }) => {
    const user = await ctx.db.get(userId);
    const ownerEmail = process.env["OWNER_EMAIL"]?.trim().toLowerCase();
    if (!ownerEmail || user?.email?.trim().toLowerCase() !== ownerEmail) {
      return null;
    }
    return await ctx.runQuery(components.mail.objects.resolve, { object });
  },
});

export const authorizeDownload = action({
  args: { object: objectReference },
  returns: v.string(),
  handler: async (ctx, { object }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Sign in is required");
    }
    const descriptor = await ctx.runQuery(internal.objects.resolve, { userId, object });
    if (!descriptor) {
      throw new Error("File not found");
    }
    const secret = process.env["MAIL_BRIDGE_SECRET"];
    const workerUrl = process.env["MAIL_WORKER_URL"];
    if (!secret || !workerUrl) {
      throw new Error("File access is not configured");
    }
    const grant = await createObjectGrant(
      {
        expiresAt: Date.now() + 5 * 60 * 1_000,
        r2Key: descriptor.r2Key,
        filename: descriptor.filename,
        contentType: descriptor.contentType,
      },
      secret,
    );
    return `${workerUrl.replace(/\/$/, "")}/api/mail/object?grant=${encodeURIComponent(grant)}`;
  },
});
