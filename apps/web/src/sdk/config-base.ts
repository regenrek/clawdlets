import { createServerFn } from "@tanstack/react-start"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfig,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { findBotClawdbotChanges } from "~/sdk/config-helpers"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/run-with-events"

export const getClawdletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects"> }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    try {
      const { configPath, config } = loadClawdletsConfig({ repoRoot })
      const json = JSON.stringify(config, null, 2)
      return {
        repoRoot,
        configPath,
        config: JSON.parse(json) as any,
        json,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.toLowerCase().includes("missing clawdlets config")) {
        const match = message.match(/missing clawdlets config:\s*(.+)$/i)
        const configPath = match?.[1]?.trim() || ""
        return {
          repoRoot,
          configPath,
          config: null,
          json: "",
          missing: true,
        }
      }
      throw err
    }
  })

export const writeClawdletsConfigFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      next: d["next"] as unknown,
      title: typeof d["title"] === "string" ? d["title"] : "Update fleet/clawdlets.json",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)

    const { configPath, config: current } = loadClawdletsConfigRaw({ repoRoot })
    const blocked = findBotClawdbotChanges(current, data.next)
    if (blocked) {
      return { ok: false as const, issues: [{ code: "policy", path: blocked.path, message: blocked.message }] }
    }

    const parsed = ClawdletsConfigSchema.safeParse(data.next)
    if (!parsed.success) return { ok: false as const, issues: mapValidationIssues(parsed.error.issues as unknown[]) }
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: data.title,
    })

    type WriteConfigResult = { ok: true; runId: typeof runId } | { ok: false; issues: ValidationIssue[] }

    return await runWithEventsAndStatus<WriteConfigResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: "Validating config…" })
        await emit({ level: "info", message: "Writing fleet/clawdlets.json…" })
        await writeClawdletsConfig({ configPath, config: parsed.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
