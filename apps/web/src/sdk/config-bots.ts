import { createServerFn } from "@tanstack/react-start"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"
import { BotIdSchema } from "@clawdlets/shared/lib/identifiers"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"

export const addBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const parsedBot = BotIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid bot id")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.botOrder = Array.isArray(next.fleet.botOrder) ? next.fleet.botOrder : []
    next.fleet.bots = next.fleet.bots && typeof next.fleet.bots === "object" && !Array.isArray(next.fleet.bots) ? next.fleet.bots : {}
    if (next.fleet.botOrder.includes(botId) || next.fleet.bots[botId]) return { ok: true as const }
    next.fleet.botOrder = [...next.fleet.botOrder, botId]
    next.fleet.bots[botId] = { profile: { secretEnv: { DISCORD_BOT_TOKEN: `discord_token_${botId}` } } }

    const validated = ClawdletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot add ${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding bot ${botId}` })
        await writeClawdletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const next = structuredClone(raw) as any
    const existingOrder = Array.isArray(next?.fleet?.botOrder) ? next.fleet.botOrder : []
    const existingBots = next?.fleet?.bots && typeof next.fleet.bots === "object" && !Array.isArray(next.fleet.bots) ? next.fleet.bots : {}
    if (!existingOrder.includes(botId) && !existingBots[botId]) throw new Error("bot not found")

    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.botOrder = existingOrder.filter((b: string) => b !== botId)
    const botsRecord = { ...existingBots }
    delete botsRecord[botId]
    next.fleet.bots = botsRecord
    if (Array.isArray(next.fleet.codex?.bots)) {
      next.fleet.codex.bots = next.fleet.codex.bots.filter((b: string) => b !== botId)
    }

    const validated = ClawdletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot rm ${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing bot ${botId}` })
        await writeClawdletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })
