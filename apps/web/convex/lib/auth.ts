import type { UserIdentity } from "convex/server";

import { isAuthDisabled } from "./env";
import { fail } from "./errors";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Authed = {
  identity: UserIdentity | null;
  user: Doc<"users">;
};

const DEV_TOKEN_IDENTIFIER = "dev";

async function ensureDevUser(ctx: MutationCtx): Promise<Authed> {
  const now = Date.now();
  const tokenIdentifier = DEV_TOKEN_IDENTIFIER;
  const existing = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
  if (existing) return { identity: null, user: existing };

  const userId = await ctx.db.insert("users", {
    tokenIdentifier,
    name: "Dev User",
    email: "dev@local",
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get(userId);
  if (!user) fail("not_found", "failed to create dev user");
  return { identity: null, user };
}

async function getUserByTokenIdentifier(ctx: QueryCtx, tokenIdentifier: string): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

async function ensureUserByIdentity(ctx: MutationCtx, identity: UserIdentity): Promise<Authed> {
  const now = Date.now();
  const tokenIdentifier = identity.tokenIdentifier;
  const existing = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      name: identity.name,
      email: identity.email,
      pictureUrl: identity.pictureUrl,
      updatedAt: now,
    });
    const patched = await ctx.db.get(existing._id);
    if (!patched) fail("not_found", "user disappeared");
    return { identity, user: patched };
  }

  const isFirstUser = (await ctx.db.query("users").take(1)).length === 0;
  const userId = await ctx.db.insert("users", {
    tokenIdentifier,
    name: identity.name,
    email: identity.email,
    pictureUrl: identity.pictureUrl,
    role: isFirstUser ? "admin" : "viewer",
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get(userId);
  if (!user) fail("not_found", "failed to create user");
  return { identity, user };
}

export async function requireAuthQuery(ctx: QueryCtx): Promise<Authed> {
  if (isAuthDisabled()) {
    const user = await getUserByTokenIdentifier(ctx, DEV_TOKEN_IDENTIFIER);
    if (!user) fail("unauthorized", "dev user missing (run users.ensureCurrent)");
    return { identity: null, user };
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthorized", "sign-in required");
  const user = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (!user) fail("unauthorized", "user missing (run users.ensureCurrent)");
  return { identity, user };
}

export async function requireAuthMutation(ctx: MutationCtx): Promise<Authed> {
  if (isAuthDisabled()) return await ensureDevUser(ctx);
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthorized", "sign-in required");
  return await ensureUserByIdentity(ctx, identity);
}

async function requireProjectAccessCommon(params: {
  ctx: QueryCtx | MutationCtx;
  authed: Authed;
  projectId: Id<"projects">;
}): Promise<{ authed: Authed; project: Doc<"projects">; role: "admin" | "viewer" }> {
  const { ctx, authed, projectId } = params;
  const project = await ctx.db.get(projectId);
  if (!project) fail("not_found", "project not found");
  if (project.ownerUserId === authed.user._id) return { authed, project, role: "admin" };

  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) => q.eq("projectId", projectId).eq("userId", authed.user._id))
    .unique();
  if (!membership) fail("forbidden", "project access denied");
  return { authed, project, role: membership.role };
}

export async function requireProjectAccessQuery(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<{ authed: Authed; project: Doc<"projects">; role: "admin" | "viewer" }> {
  const authed = await requireAuthQuery(ctx);
  return await requireProjectAccessCommon({ ctx, authed, projectId });
}

export async function requireProjectAccessMutation(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<{ authed: Authed; project: Doc<"projects">; role: "admin" | "viewer" }> {
  const authed = await requireAuthMutation(ctx);
  return await requireProjectAccessCommon({ ctx, authed, projectId });
}

export function requireAdmin(role: "admin" | "viewer"): void {
  if (role !== "admin") fail("forbidden", "admin required");
}
