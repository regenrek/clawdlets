import { ConvexError } from "convex/values";

export type ErrorCode = "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited";

export function fail(code: ErrorCode, message: string, extra?: Record<string, unknown>): never {
  throw new ConvexError({ code, message, ...(extra || {}) });
}

