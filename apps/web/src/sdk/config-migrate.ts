import { createServerFn } from "@tanstack/react-start"
import { migrateClawdletsConfigToV11 } from "@clawdlets/core/lib/clawdlets-config-migrate"
import { ClawdletsConfigSchema, writeClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import { getRepoLayout } from "@clawdlets/core/repo-layout"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getRepoRoot } from "~/sdk/repo-root"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/run-with-events"
import { readFile } from "node:fs/promises"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export const migrateClawdletsConfigFileToV11 = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { role } = await client.query(api.projects.get, { projectId: data.projectId })
    if (role !== "admin") throw new Error("admin required")

    const repoRoot = await getRepoRoot(client, data.projectId)
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

    const res = migrateClawdletsConfigToV11(parsed)
    if (!res.changed) return { ok: true as const, changed: false as const, warnings: res.warnings }

    const validated = ClawdletsConfigSchema.safeParse(res.migrated)
    if (!validated.success) {
      return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }
    }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: "Migrate fleet/clawdlets.json to schemaVersion 11",
    })

    type MigrateRunResult =
      | { ok: true; changed: true; warnings: string[]; runId: typeof runId }
      | { ok: false; issues: ValidationIssue[]; runId: typeof runId }

    return await runWithEventsAndStatus<MigrateRunResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: "Migrating config…" })
        for (const w of res.warnings) await emit({ level: "warn", message: w })
        await writeClawdletsConfig({ configPath: layout.clawdletsConfigPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onAfterEvents: async () => {
        await client.mutation(api.auditLogs.append, {
          projectId: data.projectId,
          action: "config.migrate",
          target: { to: 11, file: "fleet/clawdlets.json" },
          data: { runId, warnings: res.warnings },
        })
      },
      onSuccess: () => ({ ok: true as const, changed: true as const, warnings: res.warnings, runId }),
      onError: (message) =>
        ({ ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[], runId }),
    })
  })
