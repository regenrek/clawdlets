import { betterAuth } from "better-auth/minimal";
import { convex } from "@convex-dev/better-auth/plugins";
import { createClient } from "@convex-dev/better-auth";
import { v } from "convex/values";
import { query } from "./_generated/server";

import type { DataModel } from "./_generated/dataModel";
import { components } from "./_generated/api";
import authConfig from "./auth.config";
import { hasAuthEnv } from "./lib/env";

const SITE_URL = String(process.env.SITE_URL || "").trim();
const BETTER_AUTH_SECRET = String(process.env.BETTER_AUTH_SECRET || "").trim();
if (!hasAuthEnv()) {
  throw new Error("missing SITE_URL / BETTER_AUTH_SECRET / CONVEX_SITE_URL for Better Auth");
}

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: Parameters<typeof authComponent.adapter>[0]) =>
  betterAuth({
    database: authComponent.adapter(ctx),
    baseURL: SITE_URL,
    secret: BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
    plugins: [convex({ authConfig, jwksRotateOnTokenGenerationError: true })],
  });

export const getAuthUser = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx);
  },
});

export const getCurrentUser = query({
  args: {},
  returns: v.union(v.null(), v.any()),
  handler: async (ctx) => {
    return (await authComponent.safeGetAuthUser(ctx)) ?? null;
  },
});
