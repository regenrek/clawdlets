import { createServerFn } from "@tanstack/react-start"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getClawdletsCliEnv } from "~/server/run-env"
import { runWithEvents, spawnCommandCapture } from "~/server/run-manager"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseProjectHostInput, parseProjectRunHostInput } from "~/sdk/serverfn-validators"
import { resolveHostFromConfig } from "~/sdk/secrets-helpers"
import { requireAdminAndBoundRun } from "~/sdk/run-guards"

export const secretsVerifyStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const host = resolveHostFromConfig(config, data.host, { requireKnownHost: true })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "secrets_verify",
      title: `Secrets verify (${host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.verify",
      target: { host },
      data: { runId },
    })
    return { runId }
  })

export const secretsVerifyExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "secrets_verify",
    })

    try {
      const { config } = loadClawdletsConfig({ repoRoot })
      if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)
      const redactTokens = await readClawdletsEnvTokens(repoRoot)
      const cliEntry = resolveClawdletsCliEntry()
      const cliEnv = getClawdletsCliEnv()

      await runWithEvents({
        client,
        runId: data.runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: "Running secrets verify…" })
        },
      })

      const captured = await spawnCommandCapture({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args: [cliEntry, "secrets", "verify", "--host", data.host, "--json"],
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
        Array.isArray(parsed?.results) &&
        parsed.results.some((r: any) => r?.status === "missing")
      const ok = captured.exitCode === 0 && !hasMissing

      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: ok ? "succeeded" : "failed",
        errorMessage: ok ? undefined : "secrets verify failed",
      })

      await client.mutation(api.runEvents.appendBatch, {
        runId: data.runId,
        events: [
          {
            ts: Date.now(),
            level: ok ? "info" : "error",
            message: ok ? "Secrets verify ok" : "Secrets verify failed",
            data: parsed,
          },
        ],
      })

      return { ok, result: parsed }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "failed", errorMessage: message })
      return { ok: false as const, result: { error: message } }
    }
  })
