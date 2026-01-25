import { createServerFn } from "@tanstack/react-start"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { spawnCommand } from "~/server/run-manager"
import { assertRunBoundToProject } from "~/sdk/run-binding"
import { getRepoRoot } from "~/sdk/repo-root"
import { parseServerChannelsExecuteInput, parseServerChannelsStartInput } from "~/sdk/serverfn-validators"

export const serverChannelsStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerChannelsStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })

    const host = data.host || config.defaultHost || ""
    if (!host) throw new Error("missing host")
    if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)

    const botId = data.botId
    if (!config.fleet.bots[botId]) throw new Error(`unknown bot: ${botId}`)

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "server_channels",
      title: `Channels ${data.op} (${botId}@${host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "server.channels",
      target: { host, botId, op: data.op },
      data: { runId },
    })
    return { runId }
  })

export const serverChannelsExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerChannelsExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })

    const host = data.host || config.defaultHost || ""
    if (!host) throw new Error("missing host")
    if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)

    const botId = data.botId
    if (!config.fleet.bots[botId]) throw new Error(`unknown bot: ${botId}`)

    const runGet = await client.query(api.runs.get, { runId: data.runId })
    assertRunBoundToProject({
      runId: data.runId,
      runProjectId: runGet.run.projectId as Id<"projects">,
      expectedProjectId: data.projectId,
      runKind: runGet.run.kind,
      expectedKind: "server_channels",
    })

    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()

    const args = [
      cliEntry,
      "server",
      "channels",
      data.op,
      "--host",
      host,
      "--bot",
      botId,
    ]

    if (data.op === "status") {
      if (data.probe) args.push("--probe")
      args.push(`--timeout=${data.timeoutMs}`)
      if (data.json) args.push("--json")
    }

    if (data.op === "capabilities") {
      if (data.channel) args.push(`--channel=${data.channel}`)
      if (data.account) args.push(`--account=${data.account}`)
      if (data.target) args.push(`--target=${data.target}`)
      args.push(`--timeout=${data.timeoutMs}`)
      if (data.json) args.push("--json")
    }

    if (data.op === "login") {
      if (data.channel) args.push(`--channel=${data.channel}`)
      if (data.account) args.push(`--account=${data.account}`)
      if (data.verbose) args.push("--verbose")
    }

    if (data.op === "logout") {
      if (data.channel) args.push(`--channel=${data.channel}`)
      if (data.account) args.push(`--account=${data.account}`)
    }

    try {
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args,
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
