import { createServerFn } from "@tanstack/react-start"
import { loadClawdletsConfig, getSshExposureMode } from "@clawdlets/core/lib/clawdlets-config"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { spawnCommand } from "~/server/run-manager"
import { getRepoRoot } from "~/sdk/repo-root"
import { parseProjectHostRequiredInput, parseProjectRunHostInput } from "~/sdk/serverfn-validators"

async function setRunFailedOrCanceled(params: {
  client: ConvexClient
  runId: Id<"runs">
  error: unknown
}): Promise<{ status: "failed" | "canceled"; message: string }> {
  const message = params.error instanceof Error ? params.error.message : String(params.error)
  const canceled = message.toLowerCase().includes("canceled")
  await params.client.mutation(api.runs.setStatus, {
    runId: params.runId,
    status: canceled ? "canceled" : "failed",
    errorMessage: message,
  })
  return { status: canceled ? "canceled" : "failed", message }
}

export const lockdownStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "lockdown",
      title: `Lockdown (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "lockdown",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const lockdownExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const hostCfg = config.hosts[data.host]
    if (!hostCfg) throw new Error(`unknown host: ${data.host}`)
    const sshMode = getSshExposureMode(hostCfg)
    if (sshMode !== "tailnet") {
      throw new Error(`sshExposure.mode=${sshMode}; set sshExposure.mode=tailnet before lockdown`)
    }

    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()

    try {
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args: [cliEntry, "lockdown", "--host", data.host],
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const res = await setRunFailedOrCanceled({ client, runId: data.runId, error: err })
      return { ok: false as const, ...res }
    }
  })
