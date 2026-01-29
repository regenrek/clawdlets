import { BotIdSchema, HostNameSchema, SecretNameSchema } from "@clawdlets/shared/lib/identifiers"
import { assertSafeRecordKey, createNullProtoRecord } from "@clawdlets/core/lib/safe-record"

import type { SystemTableNames } from "convex/server"
import type { Id, TableNames } from "../../convex/_generated/dataModel"

export const SERVER_CHANNEL_OPS = ["status", "capabilities", "login", "logout"] as const
export type ServerChannelOp = (typeof SERVER_CHANNEL_OPS)[number]

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid input")
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
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid host")
  return HostNameSchema.parse(trimmed)
}

function parseBotIdRequired(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid botId")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid botId")
  return BotIdSchema.parse(trimmed)
}

function parseServerChannelOp(value: unknown): ServerChannelOp {
  if (typeof value !== "string") throw new Error("invalid op")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid op")
  if (!SERVER_CHANNEL_OPS.includes(trimmed as ServerChannelOp)) throw new Error("invalid op")
  return trimmed as ServerChannelOp
}

function parseOptionalString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length > maxLen) throw new Error("invalid input")
  return trimmed
}

function parseLines(value: unknown): string {
  if (typeof value !== "string") return "200"
  const trimmed = value.trim()
  if (!trimmed) return "200"
  if (!/^[0-9]+$/.test(trimmed)) throw new Error("invalid lines")
  return trimmed
}

function parseSecretValuesRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createNullProtoRecord<string>()
  const out = createNullProtoRecord<string>()
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string") continue
    const key = String(k || "").trim()
    const value = v.trim()
    if (!key || !value) continue
    assertSafeRecordKey({ key, context: "web secrets values" })
    void SecretNameSchema.parse(key)
    out[key] = value
  }
  return out
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
    channel: parseOptionalString(d["channel"], 64),
    account: parseOptionalString(d["account"], 64),
    target: parseOptionalString(d["target"], 128),
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

export function parseProjectIdInput(data: unknown): { projectId: Id<"projects"> } {
  const d = requireObject(data)
  return { projectId: parseConvexId(d["projectId"], "projectId") }
}

export function parseProjectHostRequiredInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const d = requireObject(data)
  return { projectId: parseConvexId(d["projectId"], "projectId"), host: parseHostNameRequired(d["host"]) }
}

export function parseHostSshKeysInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  keyText: string
  knownHostsText: string
} {
  const d = requireObject(data)
  const keyFilePath = typeof d["keyFilePath"] === "string" ? d["keyFilePath"].trim() : ""
  const knownHostsFilePath = typeof d["knownHostsFilePath"] === "string" ? d["knownHostsFilePath"].trim() : ""
  if (keyFilePath || knownHostsFilePath) {
    throw new Error("file path imports are disabled; paste or upload keys instead")
  }
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    keyText: parseOptionalString(d["keyText"], 64 * 1024),
    knownHostsText: parseOptionalString(d["knownHostsText"], 256 * 1024),
  }
}

export function parseProjectHostBotInput(data: unknown): { projectId: Id<"projects">; host: string; botId: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseOptionalHostName(d["host"]),
    botId: parseBotIdRequired(d["botId"]),
  }
}

export function parseProjectBotInput(data: unknown): { projectId: Id<"projects">; botId: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    botId: parseBotIdRequired(d["botId"]),
  }
}

export function parseBotClawdbotConfigInput(data: unknown): {
  projectId: Id<"projects">
  botId: string
  host: string
  schemaMode: "live" | "pinned"
  clawdbot: unknown
} {
  const d = requireObject(data)
  let schemaMode: "live" | "pinned" = "pinned"
  if (typeof d["schemaMode"] === "string") {
    const trimmed = d["schemaMode"].trim()
    if (trimmed) {
      if (trimmed !== "live" && trimmed !== "pinned") throw new Error("invalid schemaMode")
      schemaMode = trimmed as "live" | "pinned"
    }
  }
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    botId: parseBotIdRequired(d["botId"]),
    host: parseOptionalHostName(d["host"]),
    schemaMode,
    clawdbot: d["clawdbot"],
  }
}

export function parseProjectRunHostInput(data: unknown): { projectId: Id<"projects">; runId: Id<"runs">; host: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    runId: parseConvexId(d["runId"], "runId"),
    host: parseHostNameRequired(d["host"]),
  }
}

export function parseProjectHostTargetInput(data: unknown): { projectId: Id<"projects">; host: string; targetHost: string } {
  const base = parseProjectHostRequiredInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseProjectRunHostConfirmInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  confirm: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    confirm: typeof d["confirm"] === "string" ? d["confirm"] : "",
  }
}

export function parseServerDeployStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  manifestPath: string
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    manifestPath: parseOptionalString(d["manifestPath"], 4096),
  }
}

export function parseServerDeployExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  manifestPath: string
  rev: string
  targetHost: string
  confirm: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    manifestPath: parseOptionalString(d["manifestPath"], 4096),
    rev: parseOptionalString(d["rev"], 256),
    targetHost: parseOptionalString(d["targetHost"], 512),
    confirm: typeof d["confirm"] === "string" ? d["confirm"] : "",
  }
}

export function parseServerStatusStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerStatusExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerAuditStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerAuditExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerLogsStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  unit: string
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    unit: parseOptionalString(d["unit"], 256),
  }
}

export function parseServerLogsExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  unit: string
  lines: string
  since: string
  follow: boolean
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    unit: parseOptionalString(d["unit"], 256),
    lines: parseLines(d["lines"]),
    since: parseOptionalString(d["since"], 256),
    follow: Boolean(d["follow"]),
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerRestartStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  unit: string
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    unit: parseOptionalString(d["unit"], 256),
  }
}

export function parseServerRestartExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  unit: string
  targetHost: string
  confirm: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    unit: parseOptionalString(d["unit"], 256),
    targetHost: parseOptionalString(d["targetHost"], 512),
    confirm: typeof d["confirm"] === "string" ? d["confirm"] : "",
  }
}

export function parseSecretsInitExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  allowPlaceholders: boolean
  adminPassword: string
  adminPasswordHash: string
  tailscaleAuthKey: string
  secrets: Record<string, string>
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    allowPlaceholders: Boolean(d["allowPlaceholders"]),
    adminPassword: typeof d["adminPassword"] === "string" ? d["adminPassword"] : "",
    adminPasswordHash: typeof d["adminPasswordHash"] === "string" ? d["adminPasswordHash"] : "",
    tailscaleAuthKey: typeof d["tailscaleAuthKey"] === "string" ? d["tailscaleAuthKey"] : "",
    secrets: parseSecretValuesRecord(d["secrets"]),
  }
}

export function parseWriteHostSecretsInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  secrets: Record<string, string>
} {
  const d = requireObject(data)
  if (!d["secrets"] || typeof d["secrets"] !== "object" || Array.isArray(d["secrets"])) {
    throw new Error("invalid secrets")
  }
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    secrets: parseSecretValuesRecord(d["secrets"]),
  }
}
