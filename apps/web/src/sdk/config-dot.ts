import { createServerFn } from "@tanstack/react-start"
import {
  ClawdletsConfigSchema,
  loadClawdletsConfig,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"
import { splitDotPath } from "@clawdlets/core/lib/dot-path"
import { deleteAtPath, getAtPath, setAtPath } from "@clawdlets/core/lib/object-path"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { BOT_CLAWDBOT_POLICY_MESSAGE, isBotClawdbotPath } from "~/sdk/config-helpers"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/run-with-events"

export const configDotGet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, path: String(d["path"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const parts = splitDotPath(data.path)
    const value = getAtPath(config as any, parts)
    return { path: parts.join("."), value: value as any }
  })

export const configDotSet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      path: String(d["path"] || ""),
      value: d["value"] === undefined ? undefined : String(d["value"]),
      valueJson: d["valueJson"] === undefined ? undefined : String(d["valueJson"]),
      del: Boolean(d["del"]),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })
    const parts = splitDotPath(data.path)
    const next = structuredClone(raw) as any

    if (isBotClawdbotPath(parts)) {
      return {
        ok: false as const,
        issues: [
          {
            code: "policy",
            path: parts,
            message: BOT_CLAWDBOT_POLICY_MESSAGE,
          },
        ],
      }
    }

    if (data.del) {
      const ok = deleteAtPath(next, parts)
      if (!ok) throw new Error(`path not found: ${parts.join(".")}`)
    } else if (data.valueJson !== undefined) {
      let parsed: unknown
      try {
        parsed = JSON.parse(data.valueJson)
      } catch {
        throw new Error("invalid JSON value")
      }
      setAtPath(next, parts, parsed)
    } else if (data.value !== undefined) {
      setAtPath(next, parts, data.value)
    } else {
      throw new Error("missing value (or set del=true)")
    }

    const validated = ClawdletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `config set ${parts.join(".")}`,
    })

    type ConfigDotResult = { ok: true; runId: typeof runId } | { ok: false; issues: ValidationIssue[] }

    return await runWithEventsAndStatus<ConfigDotResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating ${parts.join(".")}` })
        await writeClawdletsConfig({ configPath, config: validated.data })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
