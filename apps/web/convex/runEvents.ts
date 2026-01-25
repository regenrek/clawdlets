import { RUN_EVENT_LEVELS } from "@clawdlets/core/lib/run-constants";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "./lib/auth";
import { rateLimit } from "./lib/rateLimit";
import { RunEventDoc } from "./lib/validators";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const RunEventLevel = v.union(...literals(RUN_EVENT_LEVELS));

export const pageByRun = query({
  args: { runId: v.id("runs"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(RunEventDoc),
  handler: async (ctx, { runId, paginationOpts }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    await requireProjectAccessQuery(ctx, run.projectId);

    const numItems = Math.max(1, Math.min(500, paginationOpts.numItems));
    return await ctx.db
      .query("runEvents")
      .withIndex("by_run_ts", (q) => q.eq("runId", runId))
      .order("desc")
      .paginate({ ...paginationOpts, numItems });
  },
});

export const appendBatch = mutation({
  args: {
    runId: v.id("runs"),
    events: v.array(
      v.object({
        ts: v.number(),
        level: RunEventLevel,
        message: v.string(),
        data: v.optional(v.any()),
        redacted: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { runId, events }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    const access = await requireProjectAccessMutation(ctx, run.projectId);
    requireAdmin(access.role);

    await rateLimit({ ctx, key: `runEvents.append:${access.authed.user._id}`, limit: 240, windowMs: 60_000 });

    const safeEvents = events.slice(0, 200);
    for (const ev of safeEvents) {
      const message = ev.message.trim();
      if (!message) continue;
      await ctx.db.insert("runEvents", {
        projectId: run.projectId,
        runId,
        ts: ev.ts,
        level: ev.level,
        message: message.length > 4000 ? `${message.slice(0, 3997)}...` : message,
        data: ev.data,
        redacted: ev.redacted,
      });
    }
    return null;
  },
});
