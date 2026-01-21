import { createServerFn } from "@tanstack/react-start"
import { BotIdSchema } from "@clawdlets/core/lib/identifiers"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents } from "~/server/run-manager"

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

async function getRepoRoot(client: ConvexClient, projectId: Id<"projects">) {
  const { project } = await client.query(api.projects.get, { projectId })
  return project.localPath
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
