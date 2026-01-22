import { createServerFn } from "@tanstack/react-start"
import { migrateClawdletsConfigToV9 } from "@clawdlets/core/lib/clawdlets-config-migrate"
import { ClawdletsConfigSchema, writeClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import { getRepoLayout } from "@clawdlets/core/repo-layout"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents } from "~/server/run-manager"
import { readFile } from "node:fs/promises"

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

export const migrateClawdletsConfigFileToV9 = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects"> }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { project, role } = await client.query(api.projects.get, { projectId: data.projectId })
    if (role !== "admin") throw new Error("admin required")

    const repoRoot = project.localPath
    const layout = getRepoLayout(repoRoot)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)

    const rawText = await readFile(layout.clawdletsConfigPath, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      return {
        ok: false as const,
        issues: [{ code: "json", path: [], message: "Invalid JSON" }] satisfies ValidationIssue[],
      }
    }

    const res = migrateClawdletsConfigToV9(parsed)
    if (!res.changed) return { ok: true as const, changed: false as const, warnings: res.warnings }

    const validated = ClawdletsConfigSchema.safeParse(res.migrated)
    if (!validated.success) {
      return { ok: false as const, issues: toIssues(validated.error.issues as unknown[]) }
    }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: "Migrate fleet/clawdlets.json to schemaVersion 9",
    })

    try {
      await runWithEvents({
        client,
        runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: "Migrating config…" })
          for (const w of res.warnings) await emit({ level: "warn", message: w })
          await writeClawdletsConfig({ configPath: layout.clawdletsConfigPath, config: validated.data })
          await emit({ level: "info", message: "Done." })
        },
      })

      await client.mutation(api.auditLogs.append, {
        projectId: data.projectId,
        action: "config.migrate",
        target: { to: 9, file: "fleet/clawdlets.json" },
        data: { runId, warnings: res.warnings },
      })
      await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
      return { ok: true as const, changed: true as const, warnings: res.warnings, runId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: message })
      return { ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[], runId }
    }
  })
