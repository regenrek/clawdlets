import { v } from "convex/values";

import { ProjectConfigType, ProjectStatus, ProviderType, Role, RunEventLevel, RunKind, RunStatus } from "../schema";

export const UserDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  tokenIdentifier: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  pictureUrl: v.optional(v.string()),
  role: Role,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const ProjectDoc = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  ownerUserId: v.id("users"),
  name: v.string(),
  localPath: v.string(),
  status: ProjectStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
  lastSeenAt: v.optional(v.number()),
});

export const ProjectMemberDoc = v.object({
  _id: v.id("projectMembers"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  userId: v.id("users"),
  role: Role,
  createdAt: v.number(),
});

export const ProjectConfigDoc = v.object({
  _id: v.id("projectConfigs"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  type: ProjectConfigType,
  path: v.string(),
  lastHash: v.optional(v.string()),
  lastSyncAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
});

export const RunDoc = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  kind: RunKind,
  status: RunStatus,
  title: v.optional(v.string()),
  initiatedByUserId: v.id("users"),
  createdAt: v.number(),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
});

export const RunEventDoc = v.object({
  _id: v.id("runEvents"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  runId: v.id("runs"),
  ts: v.number(),
  level: RunEventLevel,
  message: v.string(),
  data: v.optional(v.any()),
  redacted: v.optional(v.boolean()),
});

export const ProviderDoc = v.object({
  _id: v.id("providers"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  type: ProviderType,
  enabled: v.boolean(),
  config: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const BotDoc = v.object({
  _id: v.id("bots"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  botId: v.string(),
  enabled: v.boolean(),
  providerBindings: v.optional(v.any()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const AuditLogDoc = v.object({
  _id: v.id("auditLogs"),
  _creationTime: v.number(),
  ts: v.number(),
  userId: v.id("users"),
  projectId: v.optional(v.id("projects")),
  action: v.string(),
  target: v.optional(v.any()),
  data: v.optional(v.any()),
});

export const RateLimitDoc = v.object({
  _id: v.id("rateLimits"),
  _creationTime: v.number(),
  key: v.string(),
  windowStart: v.number(),
  count: v.number(),
});

