import { createServerFn } from "@tanstack/react-start"
import type { DoctorCheck } from "@clawdlets/core/doctor"
import { collectDoctorChecks } from "@clawdlets/core/doctor"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents, spawnCommand } from "~/server/run-manager"
import { getRepoRoot } from "~/sdk/repo-root"

function checkLevel(status: DoctorCheck["status"]): "info" | "warn" | "error" {
  if (status === "ok") return "info"
  if (status === "warn") return "warn"
  return "error"
}

export const runDoctor = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      host: String(d["host"] || ""),
      scope: (typeof d["scope"] === "string" ? d["scope"] : "all") as
        | "repo"
        | "bootstrap"
        | "server-deploy"
        | "cattle"
        | "all",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "doctor",
      title: `Doctor (${data.scope})`,
    })

    const checks = await collectDoctorChecks({
      cwd: repoRoot,
      host: data.host,
      scope: data.scope,
    })

    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Doctor scope=${data.scope} host=${data.host}` })
        for (const c of checks) {
          await emit({
            level: checkLevel(c.status),
            message: `${c.scope}: ${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`,
          })
        }
      },
    })

    const hasMissing = checks.some((c) => c.status === "missing")
    await client.mutation(api.runs.setStatus, {
      runId,
      status: hasMissing ? "failed" : "succeeded",
      errorMessage: hasMissing ? "doctor: missing requirements" : undefined,
    })

    return { runId, checks: checks as any, ok: !hasMissing }
  })

export const bootstrapStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      host: String(d["host"] || ""),
      mode: (String(d["mode"] || "nixos-anywhere").trim() || "nixos-anywhere") as "nixos-anywhere" | "image",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "bootstrap",
      title: `Bootstrap (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bootstrap",
      target: { host: data.host, mode: data.mode },
      data: { runId },
    })
    return { runId }
  })

export const bootstrapExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      runId: d["runId"] as Id<"runs">,
      host: String(d["host"] || ""),
      mode: (String(d["mode"] || "nixos-anywhere").trim() || "nixos-anywhere") as "nixos-anywhere" | "image",
      force: Boolean(d["force"]),
      dryRun: Boolean(d["dryRun"]),
      rev: typeof d["rev"] === "string" ? d["rev"] : "",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()

    try {
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args: [
          cliEntry,
          "bootstrap",
          "--host",
          data.host,
          `--mode=${data.mode}`,
          ...(data.rev.trim() ? ["--rev", data.rev.trim()] : []),
          ...(data.force ? ["--force"] : []),
          ...(data.dryRun ? ["--dry-run"] : []),
        ],
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "failed", errorMessage: message })
      return { ok: false as const, message }
    }
  })
