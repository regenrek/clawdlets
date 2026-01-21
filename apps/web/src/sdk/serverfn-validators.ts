import { BotIdSchema, HostNameSchema } from "@clawdlets/core/lib/identifiers"

import type { SystemTableNames } from "convex/server"
import type { Id, TableNames } from "../../convex/_generated/dataModel"

export const SERVER_CHANNEL_OPS = ["status", "capabilities", "login", "logout"] as const
export type ServerChannelOp = (typeof SERVER_CHANNEL_OPS)[number]

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("invalid input")
  return value as Record<string, unknown>
}

function parseConvexId<TTable extends TableNames | SystemTableNames>(value: unknown, name: string): Id<TTable> {
  if (typeof value !== "string") throw new Error(`invalid ${name}`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`invalid ${name}`)
  return trimmed as Id<TTable>
}

function parseOptionalHostName(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  return HostNameSchema.parse(trimmed)
}

function parseHostNameRequired(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid host")
  return HostNameSchema.parse(value)
}

function parseBotIdRequired(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid botId")
  return BotIdSchema.parse(value)
}

function parseServerChannelOp(value: unknown): ServerChannelOp {
  if (typeof value !== "string") throw new Error("invalid op")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid op")
  if (!SERVER_CHANNEL_OPS.includes(trimmed as ServerChannelOp)) throw new Error("invalid op")
  return trimmed as ServerChannelOp
}

function parseOptionalShortArg(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length > maxLen) throw new Error("invalid input")
  return trimmed
}

function parseTimeoutMs(value: unknown): number {
  if (value === undefined || value === null || value === "") return 10_000
  const s = typeof value === "string" ? value.trim() : String(value ?? "").trim()
  if (!s) return 10_000
  if (!/^[0-9]+$/.test(s)) throw new Error("invalid timeout")
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n)) throw new Error("invalid timeout")
  if (n < 1000 || n > 120_000) throw new Error("invalid timeout")
  return n
}

export function parseServerChannelsStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  botId: string
  op: ServerChannelOp
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseOptionalHostName(d["host"]),
    botId: parseBotIdRequired(d["botId"]),
    op: parseServerChannelOp(d["op"]),
  }
}

export function parseServerChannelsExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  botId: string
  op: ServerChannelOp
  channel: string
  account: string
  target: string
  timeoutMs: number
  json: boolean
  probe: boolean
  verbose: boolean
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    runId: parseConvexId(d["runId"], "runId"),
    host: parseOptionalHostName(d["host"]),
    botId: parseBotIdRequired(d["botId"]),
    op: parseServerChannelOp(d["op"]),
    channel: parseOptionalShortArg(d["channel"], 64),
    account: parseOptionalShortArg(d["account"], 64),
    target: parseOptionalShortArg(d["target"], 128),
    timeoutMs: parseTimeoutMs(d["timeout"]),
    json: Boolean(d["json"]),
    probe: Boolean(d["probe"]),
    verbose: Boolean(d["verbose"]),
  }
}

export function parseProjectHostInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const d = requireObject(data)
  return { projectId: parseConvexId(d["projectId"], "projectId"), host: parseOptionalHostName(d["host"]) }
}

export function parseProjectRunHostInput(data: unknown): { projectId: Id<"projects">; runId: Id<"runs">; host: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    runId: parseConvexId(d["runId"], "runId"),
    host: parseHostNameRequired(d["host"]),
  }
}
