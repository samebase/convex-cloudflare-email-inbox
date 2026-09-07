import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

type ReadContext = Pick<QueryCtx, "auth" | "db">;

export async function requireOwner(ctx: ReadContext): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Sign in is required");
  }
  const user = await ctx.db.get(userId);
  const ownerEmail = process.env["OWNER_EMAIL"]?.trim().toLowerCase();
  if (!ownerEmail || user?.email?.trim().toLowerCase() !== ownerEmail) {
    throw new Error("Owner access is required");
  }
  return user;
}
