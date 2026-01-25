import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const WIPE_TABLES = [
  "runEvents",
  "runs",
  "bots",
  "providers",
  "projectConfigs",
  "projectMembers",
  "auditLogs",
  "rateLimits",
  "projects",
] as const;

type WipeTable = (typeof WIPE_TABLES)[number];

async function wipeTable(ctx: MutationCtx, table: WipeTable) {
  const docs = await ctx.db.query(table).collect();
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
}

export const purgeProjects = internalMutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    if (args.confirm !== "DELETE_PROJECTS") {
      throw new Error("Refusing to purge. Pass confirm=DELETE_PROJECTS.");
    }
    for (const table of WIPE_TABLES) {
      await wipeTable(ctx, table);
    }
    return { ok: true, wiped: WIPE_TABLES };
  },
});
