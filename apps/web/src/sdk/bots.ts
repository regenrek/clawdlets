import { createServerFn } from "@tanstack/react-start"
import { applySecurityDefaults } from "@clawdlets/core/lib/config-patch"
import { applyCapabilityPreset, getChannelCapabilityPreset, type CapabilityPreset } from "@clawdlets/core/lib/capability-presets"
import { diffConfig, type ConfigDiffEntry } from "@clawdlets/core/lib/config-diff"
import { validateClawdbotConfig } from "@clawdlets/core/lib/clawdbot-schema-validate"
import { diffChannelSchemasFromArtifacts } from "@clawdlets/core/lib/clawdbot-schema-diff"
import { getPinnedClawdbotSchema } from "@clawdlets/core/lib/clawdbot-schema"
import { suggestSecretNameForEnvVar } from "@clawdlets/core/lib/fleet-secrets-plan-helpers"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import {
  parseBotClawdbotConfigInput,
  parseBotCapabilityPresetInput,
  parseBotCapabilityPresetPreviewInput,
  parseProjectBotInput,
  parseProjectHostBotInput,
} from "~/sdk/serverfn-validators"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/run-with-events"
import { sanitizeErrorMessage } from "@clawdlets/core/lib/safe-error"

export const LIVE_SCHEMA_ERROR_FALLBACK = "Unable to fetch schema. Check logs."

type RunFailure = { ok: false; issues: ValidationIssue[] }

export function sanitizeLiveSchemaError(err: unknown): string {
  return sanitizeErrorMessage(err, LIVE_SCHEMA_ERROR_FALLBACK)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function resolvePreset(kind: string, presetId: string): CapabilityPreset {
  if (kind === "channel") return getChannelCapabilityPreset(presetId)
  throw new Error("unsupported preset kind")
}

function ensureSecretEnvMapping(params: {
  secretEnv: Record<string, unknown>
  envVar: string
  botId: string
}): void {
  const envVar = params.envVar.trim()
  if (!envVar) return
  const existing = params.secretEnv[envVar]
  if (typeof existing === "string" && existing.trim()) return
  params.secretEnv[envVar] = suggestSecretNameForEnvVar(envVar, params.botId)
}

function ensureBotProfileSecretEnv(bot: Record<string, unknown>): Record<string, unknown> {
  const profile = isPlainObject(bot.profile) ? (bot.profile as Record<string, unknown>) : {}
  bot.profile = profile
  const secretEnv = isPlainObject(profile.secretEnv) ? (profile.secretEnv as Record<string, unknown>) : {}
  profile.secretEnv = secretEnv
  return secretEnv
}

function mapSchemaIssues(issues: Array<{ path: Array<string | number>; message: string }>): ValidationIssue[] {
  return issues.map((issue) => ({
    code: "schema",
    path: issue.path,
    message: issue.message,
  }))
}

function mapSchemaFailure(message: string): ValidationIssue[] {
  return [{ code: "schema", path: [], message }]
}

export const setBotClawdbotConfig = createServerFn({ method: "POST" })
  .inputValidator(parseBotClawdbotConfigInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()

    if (!isPlainObject(data.clawdbot)) throw new Error("clawdbot config must be a JSON object")

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const existingBot = next?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    existingBot.clawdbot = data.clawdbot

    const schemaMode = data.schemaMode === "live" ? "live" : "pinned"
    let schema: Record<string, unknown> | undefined = undefined
    if (schemaMode === "live") {
      try {
        const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
        const live = await fetchClawdbotSchemaLive({
          projectId: data.projectId,
          host: data.host,
          botId,
        })
        if (!live.ok) {
          return { ok: false as const, issues: [{ code: "schema", path: [], message: live.message }] satisfies ValidationIssue[] }
        }
        schema = live.schema.schema as Record<string, unknown>
      } catch (err) {
        const message = sanitizeLiveSchemaError(err)
        console.error("setBotClawdbotConfig live schema failed", message)
        return {
          ok: false as const,
          issues: mapSchemaFailure(message),
        }
      }
    }

    const schemaValidation = validateClawdbotConfig(existingBot.clawdbot, schema)
    if (!schemaValidation.ok) {
      return {
        ok: false as const,
        issues: mapSchemaIssues(schemaValidation.issues),
      }
    }

    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${botId} clawdbot config`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.clawdbot.write",
      target: { botId },
      data: { runId },
    })

    type SetClawdbotResult = { ok: true; runId: typeof runId } | RunFailure

    return await runWithEventsAndStatus<SetClawdbotResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating fleet.bots.${botId}.clawdbot` })
        await writeClawdletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })

export const applyBotCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseBotCapabilityPresetInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const preset = resolvePreset(data.kind, data.presetId)
    if (data.schemaMode === "live" && !data.host.trim()) {
      return { ok: false as const, issues: mapSchemaFailure("live schema validation requires a host") }
    }

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const existingBot = next?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    let warnings: string[] = []
    try {
      const result = applyCapabilityPreset({ clawdbot: existingBot.clawdbot, preset })
      existingBot.clawdbot = result.clawdbot
      warnings = result.warnings
      const secretEnv = ensureBotProfileSecretEnv(existingBot)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, botId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const schemaValidation = validateClawdbotConfig(existingBot.clawdbot)
    if (!schemaValidation.ok) {
      return { ok: false as const, issues: mapSchemaIssues(schemaValidation.issues) }
    }

    if (data.schemaMode === "live") {
      try {
        const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
        const live = await fetchClawdbotSchemaLive({
          projectId: data.projectId,
          host: data.host,
          botId,
        })
        if (!live.ok) {
          return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
        }
        const liveValidation = validateClawdbotConfig(existingBot.clawdbot, live.schema.schema as Record<string, unknown>)
        if (!liveValidation.ok) {
          return { ok: false as const, issues: mapSchemaIssues(liveValidation.issues) }
        }
      } catch (err) {
        const message = sanitizeLiveSchemaError(err)
        return { ok: false as const, issues: mapSchemaFailure(message) }
      }
    }

    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${botId} preset ${preset.id}`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.preset.apply",
      target: { botId },
      data: { preset: preset.id, runId, warnings },
    })

    type ApplyPresetResult = { ok: true; runId: typeof runId; warnings: string[] } | RunFailure

    return await runWithEventsAndStatus<ApplyPresetResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Applying ${preset.id} preset for ${botId}` })
        for (const w of warnings) await emit({ level: "warn", message: w })
        await writeClawdletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })

export const previewBotCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseBotCapabilityPresetPreviewInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const preset = resolvePreset(data.kind, data.presetId)
    const { config: raw } = loadClawdletsConfigRaw({
      repoRoot: (await getAdminProjectContext(createConvexClient(), data.projectId)).repoRoot,
    })
    const existingBot = (raw as any)?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const nextBot = structuredClone(existingBot) as Record<string, unknown>
    let warnings: string[] = []
    let requiredEnv: string[] = []
    try {
      const result = applyCapabilityPreset({ clawdbot: (nextBot as any).clawdbot, preset })
      ;(nextBot as any).clawdbot = result.clawdbot
      warnings = result.warnings
      requiredEnv = result.requiredEnv
      const secretEnv = ensureBotProfileSecretEnv(nextBot)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, botId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const schemaValidation = validateClawdbotConfig((nextBot as any).clawdbot)
    const diff = diffConfig(existingBot, nextBot, `fleet.bots.${botId}`)

    return {
      ok: true as const,
      diff: diff as ConfigDiffEntry[],
      warnings,
      requiredEnv,
      issues: schemaValidation.ok ? [] : mapSchemaIssues(schemaValidation.issues),
    }
  })

export const verifyBotClawdbotSchema = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostBotInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    if (!data.host.trim()) {
      return { ok: false as const, issues: mapSchemaFailure("live schema verification requires a host") }
    }
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config: raw } = loadClawdletsConfigRaw({ repoRoot })
    const existingBot = (raw as any)?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const pinned = getPinnedClawdbotSchema()
    let liveSchema: Record<string, unknown> | null = null
    try {
      const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
      const live = await fetchClawdbotSchemaLive({
        projectId: data.projectId,
        host: data.host,
        botId,
      })
      if (!live.ok) {
        return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
      }
      liveSchema = live.schema.schema as Record<string, unknown>
      const liveValidation = validateClawdbotConfig((existingBot as any).clawdbot, liveSchema)
      return {
        ok: true as const,
        issues: liveValidation.ok ? [] : mapSchemaIssues(liveValidation.issues),
        schemaDiff: diffChannelSchemasFromArtifacts(pinned, live.schema),
        liveVersion: live.schema.version,
        pinnedVersion: pinned.version,
      }
    } catch (err) {
      const message = sanitizeLiveSchemaError(err)
      return { ok: false as const, issues: mapSchemaFailure(message) }
    }
  })

export const hardenBotClawdbotConfig = createServerFn({ method: "POST" })
  .inputValidator(parseProjectBotInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const existingBot = next?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const hardened = applySecurityDefaults({ clawdbot: existingBot.clawdbot })
    if (hardened.changes.length === 0) return { ok: true as const, changes: [], warnings: [] }

    existingBot.clawdbot = hardened.clawdbot
    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${botId} clawdbot harden`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.clawdbot.harden",
      target: { botId },
      data: { runId, changes: hardened.changes, warnings: hardened.warnings },
    })

    type HardenResult = {
      ok: true
      runId: typeof runId
      changes: typeof hardened.changes
      warnings: typeof hardened.warnings
    } | RunFailure

    return await runWithEventsAndStatus<HardenResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Hardening fleet.bots.${botId}.clawdbot` })
        for (const w of hardened.warnings) await emit({ level: "warn", message: w })
        await writeClawdletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, changes: hardened.changes, warnings: hardened.warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
