import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  requireAuthMutation,
  requireProjectAccessMutation,
  requireProjectAccessQuery,
  requireAdmin,
} from "./lib/auth";
import { rateLimit } from "./lib/rateLimit";
import { AuditLogDoc } from "./lib/validators";

export const listByProjectPage = query({
  args: { projectId: v.id("projects"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(AuditLogDoc),
  handler: async (ctx, { projectId, paginationOpts }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const numItems = Math.max(1, Math.min(200, paginationOpts.numItems));
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_project_ts", (q) => q.eq("projectId", projectId))
      .order("desc")
      .paginate({ ...paginationOpts, numItems });
  },
});

export const append = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    action: v.string(),
    target: v.optional(v.any()),
    data: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireAuthMutation(ctx);
    await rateLimit({ ctx, key: `audit.append:${user._id}`, limit: 120, windowMs: 60_000 });

    if (args.projectId) {
      const { role } = await requireProjectAccessMutation(ctx, args.projectId);
      requireAdmin(role);
    }

    await ctx.db.insert("auditLogs", {
      ts: Date.now(),
      userId: user._id,
      projectId: args.projectId,
      action: args.action.trim(),
      target: args.target,
      data: args.data,
    });
    return null;
  },
});
