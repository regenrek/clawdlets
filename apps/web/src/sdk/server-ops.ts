import { createServerFn } from "@tanstack/react-start"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getClawdletsCliEnv } from "~/server/run-env"
import { spawnCommand, spawnCommandCapture } from "~/server/run-manager"
import { requireAdminAndBoundRun } from "~/sdk/run-guards"
import {
  parseServerAuditExecuteInput,
  parseServerAuditStartInput,
  parseServerDeployExecuteInput,
  parseServerDeployStartInput,
  parseServerLogsExecuteInput,
  parseServerLogsStartInput,
  parseServerRestartExecuteInput,
  parseServerRestartStartInput,
  parseServerStatusExecuteInput,
  parseServerStatusStartInput,
} from "~/sdk/serverfn-validators"

function requireTypedConfirmation(params: {
  expected: string
  received: string
}): void {
  const expected = params.expected.trim()
  const received = params.received.trim()
  if (!expected) throw new Error("missing confirmation policy")
  if (expected !== received) {
    throw new Error(`confirmation mismatch (expected: "${expected}")`)
  }
}

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

export const serverDeployStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerDeployStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "deploy",
      title: `Deploy (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "server.deploy",
      target: { host: data.host, manifestPath: data.manifestPath },
      data: { runId },
    })
    return { runId }
  })

export const serverDeployExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerDeployExecuteInput)
  .handler(async ({ data }) => {
    const expected = `deploy ${data.host}`.trim()
    requireTypedConfirmation({ expected, received: data.confirm })

    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "deploy",
    })
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()
    const cliEnv = getClawdletsCliEnv()

    try {
      const args = [
        cliEntry,
        "server",
        "deploy",
        "--host",
        data.host,
        "--manifest",
        data.manifestPath,
        ...(data.rev.trim() ? ["--rev", data.rev.trim()] : []),
        ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
        "--ssh-tty=false",
      ]
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args,
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const res = await setRunFailedOrCanceled({ client, runId: data.runId, error: err })
      return { ok: false as const, ...res }
    }
  })

export const serverStatusStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerStatusStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "server_status",
      title: `Server status (${data.host})`,
    })
    return { runId }
  })

export const serverStatusExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerStatusExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_status",
    })
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()
    const cliEnv = getClawdletsCliEnv()

    try {
      const args = [
        cliEntry,
        "server",
        "status",
        "--host",
        data.host,
        ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
        "--ssh-tty=false",
      ]
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args,
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const res = await setRunFailedOrCanceled({ client, runId: data.runId, error: err })
      return { ok: false as const, ...res }
    }
  })

export const serverAuditStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerAuditStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "server_audit",
      title: `Server audit (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "server.audit",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const serverAuditExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerAuditExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_audit",
    })
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()
    const cliEnv = getClawdletsCliEnv()

    try {
      const args = [
        cliEntry,
        "server",
        "audit",
        "--host",
        data.host,
        ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
        "--json",
        "--ssh-tty=false",
      ]
      const captured = await spawnCommandCapture({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args,
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
        maxCaptureBytes: 512_000,
        allowNonZeroExit: true,
      })

      let parsed: any = null
      try {
        parsed = JSON.parse(captured.stdout || "")
      } catch {
        parsed = { raw: captured.stdout || "", stderr: captured.stderr || "", exitCode: captured.exitCode }
      }

      const hasMissing =
        Array.isArray(parsed?.checks) && parsed.checks.some((c: any) => c?.status === "missing")
      const ok = captured.exitCode === 0 && !hasMissing

      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: ok ? "succeeded" : "failed",
        errorMessage: ok ? undefined : "server audit failed",
      })

      await client.mutation(api.runEvents.appendBatch, {
        runId: data.runId,
        events: [
          {
            ts: Date.now(),
            level: ok ? "info" : "error",
            message: ok ? "Server audit ok" : "Server audit failed",
            data: parsed,
          },
        ],
      })

      return { ok, result: parsed }
    } catch (err) {
      const res = await setRunFailedOrCanceled({ client, runId: data.runId, error: err })
      return { ok: false as const, ...res, result: { error: res.message } }
    }
  })

export const serverLogsStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerLogsStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const unit = data.unit.trim() || "clawdbot-*.service"
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "server_logs",
      title: `Logs (${data.host} · ${unit})`,
    })
    return { runId }
  })

export const serverLogsExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerLogsExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_logs",
    })
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()
    const cliEnv = getClawdletsCliEnv()

    const unit = data.unit.trim() || "clawdbot-*.service"
    const lines = data.lines.trim() || "200"

    try {
      const args = [
        cliEntry,
        "server",
        "logs",
        "--host",
        data.host,
        "--unit",
        unit,
        "--lines",
        lines,
        ...(data.since.trim() ? ["--since", data.since.trim()] : []),
        ...(data.follow ? ["--follow"] : []),
        ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
        "--ssh-tty=false",
      ]
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args,
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const res = await setRunFailedOrCanceled({ client, runId: data.runId, error: err })
      return { ok: false as const, ...res }
    }
  })

export const serverRestartStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerRestartStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const unit = data.unit.trim() || "clawdbot-*.service"
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "server_restart",
      title: `Restart (${data.host} · ${unit})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "server.restart",
      target: { host: data.host, unit },
      data: { runId },
    })
    return { runId }
  })

export const serverRestartExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerRestartExecuteInput)
  .handler(async ({ data }) => {
    const unit = data.unit.trim() || "clawdbot-*.service"
    const expected = `restart ${unit}`.trim()
    requireTypedConfirmation({ expected, received: data.confirm })

    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_restart",
    })
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()
    const cliEnv = getClawdletsCliEnv()

    try {
      const args = [
        cliEntry,
        "server",
        "restart",
        "--host",
        data.host,
        "--unit",
        unit,
        ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
        "--ssh-tty=false",
      ]
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args,
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const res = await setRunFailedOrCanceled({ client, runId: data.runId, error: err })
      return { ok: false as const, ...res }
    }
  })
