import { createServerFn } from "@tanstack/react-start"
import type { ClawdbotSchemaArtifact } from "@clawdlets/core/lib/clawdbot-schema"
import { buildClawdbotBotConfig } from "@clawdlets/core/lib/clawdbot-config-invariants"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import { shellQuote, sshCapture, validateTargetHost } from "@clawdlets/core/lib/ssh-remote"
import { createConvexClient } from "~/server/convex"
import { getRepoRoot } from "~/sdk/repo-root"
import { parseProjectHostBotInput } from "~/sdk/serverfn-validators"

function extractJsonBlock(raw: string): string {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON payload in output")
  return raw.slice(start, end + 1)
}

export type ClawdbotSchemaLiveResult =
  | { ok: true; schema: ClawdbotSchemaArtifact }
  | { ok: false; message: string }

function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim())
}

function buildGatewaySchemaCommand(params: { botId: string; port: number; sudo: boolean }): string {
  const envFile = `/srv/clawdbot/${params.botId}/credentials/gateway.env`
  const url = `ws://127.0.0.1:${params.port}`
  const script = [
    "set -euo pipefail",
    `source ${envFile}`,
    `clawdbot gateway call config.schema --url ${url} --token "$CLAWDBOT_GATEWAY_TOKEN" --json`,
  ].join(" && ")
  const args = [
    ...(params.sudo ? ["sudo", "-u", `bot-${params.botId}`] : []),
    "bash",
    "-lc",
    script,
  ]
  return args.map((a) => shellQuote(a)).join(" ")
}

export const getClawdbotSchemaLive = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostBotInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })

    const host = data.host || config.defaultHost || ""
    if (!host) throw new Error("missing host")
    if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)
    if (!config.fleet.bots[data.botId]) throw new Error(`unknown bot: ${data.botId}`)

    const targetHostRaw = String((config.hosts[host] as any)?.targetHost || "").trim()
    if (!targetHostRaw) {
      throw new Error(
        `missing targetHost for ${host}. Set hosts.${host}.targetHost (Hosts → Settings → Target host), save, reload.`,
      )
    }
    const targetHost = validateTargetHost(targetHostRaw)

    const botConfig = buildClawdbotBotConfig({ config, bot: data.botId })
    const gateway = (botConfig.invariants as any)?.gateway || {}
    const port = typeof gateway.port === "number" ? gateway.port : Number(gateway.port || 0)
    if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid gateway port for bot ${data.botId}`)

    try {
      const remoteCmd = buildGatewaySchemaCommand({ botId: data.botId, port, sudo: needsSudo(targetHost) })
      const raw = await sshCapture(targetHost, remoteCmd, {
        cwd: repoRoot,
        timeoutMs: 15_000,
        maxOutputBytes: 5 * 1024 * 1024,
      })
      const payload = extractJsonBlock(raw || "")
      const parsed = JSON.parse(payload) as ClawdbotSchemaArtifact
      return { ok: true as const, schema: parsed } satisfies ClawdbotSchemaLiveResult
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, message } satisfies ClawdbotSchemaLiveResult
    }
  })
