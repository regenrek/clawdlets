import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ProjectDoc } from "./lib/validators";
import { Role } from "./schema";
import {
  requireAuthMutation,
  requireAuthQuery,
  requireProjectAccessMutation,
  requireProjectAccessQuery,
  requireAdmin,
} from "./lib/auth";
import { fail } from "./lib/errors";
import { rateLimit } from "./lib/rateLimit";
import { BotIdSchema, HostNameSchema } from "@clawdlets/shared/lib/identifiers";

const LIVE_SCHEMA_TARGET_MAX_LEN = 128;

function parseLiveSchemaTarget(args: { host: string; botId: string }): { host: string; botId: string } {
  const host = args.host.trim();
  const botId = args.botId.trim();
  if (!host) fail("conflict", "host required");
  if (!botId) fail("conflict", "botId required");
  if (host.length > LIVE_SCHEMA_TARGET_MAX_LEN) fail("conflict", "host too long");
  if (botId.length > LIVE_SCHEMA_TARGET_MAX_LEN) fail("conflict", "botId too long");
  const hostParsed = HostNameSchema.safeParse(host);
  if (!hostParsed.success) fail("conflict", hostParsed.error.issues[0]?.message ?? "invalid host");
  const botParsed = BotIdSchema.safeParse(botId);
  if (!botParsed.success) fail("conflict", botParsed.error.issues[0]?.message ?? "invalid bot id");
  return { host, botId };
}

export function __test_parseLiveSchemaTarget(args: { host: string; botId: string }): { host: string; botId: string } {
  return parseLiveSchemaTarget(args);
}

export const list = query({
  args: {},
  returns: v.array(ProjectDoc),
  handler: async (ctx) => {
    const { user } = await requireAuthQuery(ctx);

    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .collect();

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const memberProjects = (await Promise.all(memberships.map(async (m) => await ctx.db.get(m.projectId)))).filter(
      (p): p is Doc<"projects"> => p !== null,
    );

    const byId = new Map<string, Doc<"projects">>();
    for (const p of owned) byId.set(p._id, p);
    for (const p of memberProjects) byId.set(p._id, p);
    return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  returns: v.object({ project: ProjectDoc, role: Role }),
  handler: async (ctx, { projectId }) => {
    const { project, role } = await requireProjectAccessQuery(ctx, projectId);
    return { project, role };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    localPath: v.string(),
  },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args) => {
    const { user } = await requireAuthMutation(ctx);
    await rateLimit({ ctx, key: `projects.create:${user._id}`, limit: 10, windowMs: 60_000 });

    const now = Date.now();
    const name = args.name.trim();
    const localPath = args.localPath.trim();
    if (!name) fail("conflict", "name required");
    if (!localPath) fail("conflict", "localPath required");

    const existingByName = await ctx.db
      .query("projects")
      .withIndex("by_owner_name", (q) => q.eq("ownerUserId", user._id).eq("name", name))
      .unique();
    if (existingByName) fail("conflict", "project name already exists");

    const existingByPath = await ctx.db
      .query("projects")
      .withIndex("by_owner_localPath", (q) => q.eq("ownerUserId", user._id).eq("localPath", localPath))
      .unique();
    if (existingByPath) fail("conflict", "project path already exists");

    const projectId = await ctx.db.insert("projects", {
      ownerUserId: user._id,
      name,
      localPath,
      status: "creating",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });
    return { projectId };
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    localPath: v.optional(v.string()),
    status: v.optional(v.union(v.literal("creating"), v.literal("ready"), v.literal("error"))),
  },
  returns: ProjectDoc,
  handler: async (ctx, args) => {
    const { projectId, ...patch } = args;
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);

    const now = Date.now();
    const next: Record<string, unknown> = { updatedAt: now };
    if (typeof patch.name === "string") next["name"] = patch.name.trim();
    if (typeof patch.localPath === "string") next["localPath"] = patch.localPath.trim();
    if (typeof patch.status === "string") next["status"] = patch.status;

    await ctx.db.patch(projectId, next);
    const updated = await ctx.db.get(projectId);
    if (!updated) fail("not_found", "project not found");
    return updated;
  },
});

export const guardLiveSchemaFetch = mutation({
  args: {
    projectId: v.id("projects"),
    host: v.string(),
    botId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);

    const { host, botId } = parseLiveSchemaTarget(args);

    await rateLimit({ ctx, key: `schemaLive.fetch:${args.projectId}`, limit: 20, windowMs: 60_000 });
    await ctx.db.insert("auditLogs", {
      ts: Date.now(),
      userId: access.authed.user._id,
      projectId: args.projectId,
      action: "clawdbot.schema.live.fetch",
      target: { host, botId },
    });
    return null;
  },
});
