import { createServerFn } from "@tanstack/react-start"
import { CHANNEL_PRESETS, applyChannelPreset, applySecurityDefaults } from "@clawdlets/core/lib/config-patch"
import { validateClawdbotConfig } from "@clawdlets/core/lib/clawdbot-schema-validate"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseBotClawdbotConfigInput, parseProjectBotInput } from "~/sdk/serverfn-validators"
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
          issues: [{ code: "schema", path: [], message }] satisfies ValidationIssue[],
        }
      }
    }

    const schemaValidation = validateClawdbotConfig(existingBot.clawdbot, schema)
    if (!schemaValidation.ok) {
      return {
        ok: false as const,
        issues: schemaValidation.issues.map((issue) => ({
          code: "schema",
          path: issue.path,
          message: issue.message,
        })),
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

export const applyBotChannelPreset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectBotInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      preset: String(d["preset"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const botId = data.botId.trim()

    const preset = data.preset.trim()
    if (!CHANNEL_PRESETS.includes(preset as any)) throw new Error("invalid channel preset")

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const existingBot = next?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const { clawdbot, warnings } = applyChannelPreset({ clawdbot: existingBot.clawdbot, preset: preset as any })
    {
      const hardened = applySecurityDefaults({ clawdbot })
      existingBot.clawdbot = hardened.clawdbot
      for (const w of hardened.warnings) warnings.push(w)
    }

    existingBot.profile = existingBot.profile && typeof existingBot.profile === "object" && !Array.isArray(existingBot.profile)
      ? existingBot.profile
      : {}
    existingBot.profile.secretEnv = existingBot.profile.secretEnv && typeof existingBot.profile.secretEnv === "object" && !Array.isArray(existingBot.profile.secretEnv)
      ? existingBot.profile.secretEnv
      : {}

    const secretEnv = existingBot.profile.secretEnv as Record<string, unknown>

    if (preset === "discord") {
      if (typeof secretEnv["DISCORD_BOT_TOKEN"] !== "string" || !String(secretEnv["DISCORD_BOT_TOKEN"]).trim()) {
        secretEnv["DISCORD_BOT_TOKEN"] = `discord_token_${botId}`
      }
    }

    if (preset === "telegram") {
      if (typeof secretEnv["TELEGRAM_BOT_TOKEN"] !== "string" || !String(secretEnv["TELEGRAM_BOT_TOKEN"]).trim()) {
        secretEnv["TELEGRAM_BOT_TOKEN"] = `telegram_bot_token_${botId}`
      }
    }

    if (preset === "slack") {
      if (typeof secretEnv["SLACK_BOT_TOKEN"] !== "string" || !String(secretEnv["SLACK_BOT_TOKEN"]).trim()) {
        secretEnv["SLACK_BOT_TOKEN"] = `slack_bot_token_${botId}`
      }
      if (typeof secretEnv["SLACK_APP_TOKEN"] !== "string" || !String(secretEnv["SLACK_APP_TOKEN"]).trim()) {
        secretEnv["SLACK_APP_TOKEN"] = `slack_app_token_${botId}`
      }
    }

    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${botId} preset ${preset}`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.preset.apply",
      target: { botId },
      data: { preset, runId, warnings },
    })

    type ApplyPresetResult = { ok: true; runId: typeof runId; warnings: string[] } | RunFailure

    return await runWithEventsAndStatus<ApplyPresetResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Applying ${preset} preset for ${botId}` })
        for (const w of warnings) await emit({ level: "warn", message: w })
        await writeClawdletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
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
