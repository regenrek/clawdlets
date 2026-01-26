import { createServerFn } from "@tanstack/react-start"
import { BotIdSchema } from "@clawdlets/shared/lib/identifiers"
import { CHANNEL_PRESETS, applyChannelPreset, applySecurityDefaults } from "@clawdlets/core/lib/config-patch"
import { validateClawdbotConfig } from "@clawdlets/core/lib/clawdbot-schema-validate"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents } from "~/server/run-manager"
import { getRepoRoot } from "~/sdk/repo-root"

type ValidationIssue = { code: string; path: Array<string | number>; message: string }

function toIssues(issues: unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    const i = issue as { code?: unknown; path?: unknown; message?: unknown }
    return {
      code: String(i.code ?? "invalid"),
      path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
      message: String(i.message ?? "Invalid"),
    }
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export const setBotClawdbotConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: String(d["botId"] || ""),
      clawdbot: d["clawdbot"] as unknown,
    }
  })
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const parsedBot = BotIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid bot id")

    if (!isPlainObject(data.clawdbot)) throw new Error("clawdbot config must be a JSON object")

    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const existingBot = next?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    existingBot.clawdbot = data.clawdbot
    const schemaValidation = validateClawdbotConfig(existingBot.clawdbot)
    if (!schemaValidation.ok) {
      return {
        ok: false as const,
        issues: schemaValidation.errors.map((message) => ({
          code: "schema",
          path: [],
          message,
        })),
      }
    }

    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: toIssues(validated.error.issues as unknown[]) }

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

    try {
      await runWithEvents({
        client,
        runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: `Updating fleet.bots.${botId}.clawdbot` })
          await writeClawdletsConfig({ configPath, config: validated.data })
          await emit({ level: "info", message: "Done." })
        },
      })
      await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
      return { ok: true as const, runId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: message })
      return { ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[] }
    }
  })

export const applyBotChannelPreset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: String(d["botId"] || ""),
      preset: String(d["preset"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const parsedBot = BotIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid bot id")

    const preset = data.preset.trim()
    if (!CHANNEL_PRESETS.includes(preset as any)) throw new Error("invalid channel preset")

    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
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
    if (!validated.success) return { ok: false as const, issues: toIssues(validated.error.issues as unknown[]) }

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

    try {
      await runWithEvents({
        client,
        runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: `Applying ${preset} preset for ${botId}` })
          for (const w of warnings) await emit({ level: "warn", message: w })
          await writeClawdletsConfig({ configPath, config: validated.data })
          await emit({ level: "info", message: "Done." })
        },
      })
      await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
      return { ok: true as const, runId, warnings }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: message })
      return { ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[] }
    }
  })

export const hardenBotClawdbotConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: String(d["botId"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const parsedBot = BotIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid bot id")

    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const existingBot = next?.fleet?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const hardened = applySecurityDefaults({ clawdbot: existingBot.clawdbot })
    if (hardened.changes.length === 0) return { ok: true as const, changes: [], warnings: [] }

    existingBot.clawdbot = hardened.clawdbot
    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: toIssues(validated.error.issues as unknown[]) }

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

    try {
      await runWithEvents({
        client,
        runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: `Hardening fleet.bots.${botId}.clawdbot` })
          for (const w of hardened.warnings) await emit({ level: "warn", message: w })
          await writeClawdletsConfig({ configPath, config: validated.data })
          await emit({ level: "info", message: "Done." })
        },
      })
      await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
      return { ok: true as const, runId, changes: hardened.changes, warnings: hardened.warnings }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: message })
      return { ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[] }
    }
  })
