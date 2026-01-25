import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { RUN_EVENT_LEVELS, RUN_KINDS, RUN_STATUSES } from "@clawdlets/core/lib/run-constants";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

export const RunKind = v.union(...literals(RUN_KINDS));
export const RunStatus = v.union(...literals(RUN_STATUSES));
export const RunEventLevel = v.union(...literals(RUN_EVENT_LEVELS));

export const Role = v.union(v.literal("admin"), v.literal("viewer"));
export const ProjectStatus = v.union(v.literal("creating"), v.literal("ready"), v.literal("error"));
export const ProjectConfigType = v.union(
  v.literal("fleet"),
  v.literal("host"),
  v.literal("bot"),
  v.literal("provider"),
  v.literal("raw"),
);
export const ProviderType = v.union(v.literal("discord"), v.literal("telegram"));

const schema = defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
    role: Role,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  projects: defineTable({
    ownerUserId: v.id("users"),
    name: v.string(),
    localPath: v.string(),
    status: ProjectStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_name", ["ownerUserId", "name"])
    .index("by_owner_localPath", ["ownerUserId", "localPath"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: Role,
    createdAt: v.number(),
  })
    .index("by_project_user", ["projectId", "userId"])
    .index("by_user", ["userId"]),

  projectConfigs: defineTable({
    projectId: v.id("projects"),
    type: ProjectConfigType,
    path: v.string(),
    lastHash: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_project_type", ["projectId", "type"])
    .index("by_project_path", ["projectId", "path"]),

  runs: defineTable({
    projectId: v.id("projects"),
    kind: RunKind,
    status: RunStatus,
    title: v.optional(v.string()),
    initiatedByUserId: v.id("users"),
    createdAt: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_project_startedAt", ["projectId", "startedAt"])
    .index("by_project_status", ["projectId", "status"]),

  runEvents: defineTable({
    projectId: v.id("projects"),
    runId: v.id("runs"),
    ts: v.number(),
    level: RunEventLevel,
    message: v.string(),
    data: v.optional(v.any()),
    redacted: v.optional(v.boolean()),
  })
    .index("by_run_ts", ["runId", "ts"])
    .index("by_project_ts", ["projectId", "ts"]),

  providers: defineTable({
    projectId: v.id("projects"),
    type: ProviderType,
    enabled: v.boolean(),
    config: v.optional(v.any()), // non-secret
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"]),

  bots: defineTable({
    projectId: v.id("projects"),
    botId: v.string(),
    enabled: v.boolean(),
    providerBindings: v.optional(v.any()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_botId", ["projectId", "botId"]),

  auditLogs: defineTable({
    ts: v.number(),
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    action: v.string(),
    target: v.optional(v.any()),
    data: v.optional(v.any()),
  })
    .index("by_project_ts", ["projectId", "ts"])
    .index("by_user_ts", ["userId", "ts"]),

  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});

export default schema;
