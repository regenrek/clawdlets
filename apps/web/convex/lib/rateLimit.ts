import { fail } from "./errors";
import type { MutationCtx } from "../_generated/server";

export async function rateLimit(params: {
  ctx: MutationCtx;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<void> {
  const now = Date.now();
  const windowStart = Math.floor(now / params.windowMs) * params.windowMs;
  const existing = await params.ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", params.key))
    .unique();

  if (!existing) {
    await params.ctx.db.insert("rateLimits", { key: params.key, windowStart, count: 1 });
    return;
  }

  if (existing.windowStart !== windowStart) {
    await params.ctx.db.patch(existing._id, { windowStart, count: 1 });
    return;
  }

  if (existing.count >= params.limit) {
    fail("rate_limited", "too many requests", { retryAt: windowStart + params.windowMs });
  }

  await params.ctx.db.patch(existing._id, { count: existing.count + 1 });
}

