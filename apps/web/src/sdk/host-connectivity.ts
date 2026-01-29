import { createServerFn } from "@tanstack/react-start"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import { getRepoLayout, getHostOpenTofuDir } from "@clawdlets/core/repo-layout"
import { capture } from "@clawdlets/core/lib/run"
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds"
import { sshCapture, validateTargetHost } from "@clawdlets/core/lib/ssh-remote"
import {
  extractFirstIpv4,
  isTailscaleIpv4,
  normalizeSingleLineOutput,
  parseBootstrapIpv4FromLogs,
} from "@clawdlets/core/lib/host-connectivity"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { getRepoRoot } from "~/sdk/repo-root"
import { parseProjectHostRequiredInput, parseProjectHostTargetInput } from "~/sdk/serverfn-validators"

export type PublicIpv4Result =
  | { ok: true; ipv4: string; source: "opentofu" | "bootstrap_logs" }
  | { ok: false; error: string; source: "opentofu" | "bootstrap_logs" | "none" }

export type TailscaleIpv4Result =
  | { ok: true; ipv4: string }
  | { ok: false; error: string; raw?: string }

export type SshReachabilityResult =
  | { ok: true; hostname?: string }
  | { ok: false; error: string }

async function resolveBootstrapIpv4(params: { projectId: Id<"projects">; host: string }): Promise<PublicIpv4Result> {
  const client = createConvexClient()
  const page = await client.query(api.runs.listByProjectPage, {
    projectId: params.projectId,
    paginationOpts: { numItems: 50, cursor: null },
  })
  const runs = page.page || []
  const match = runs.find((run: any) => run.kind === "bootstrap" && String(run.title || "").includes(params.host))
  if (!match) return { ok: false, error: "bootstrap run not found", source: "bootstrap_logs" }

  const eventsPage = await client.query(api.runEvents.pageByRun, {
    runId: match._id,
    paginationOpts: { numItems: 200, cursor: null },
  })
  const messages = (eventsPage.page || []).map((ev: any) => String(ev.message || ""))
  const ipv4 = parseBootstrapIpv4FromLogs(messages)
  if (!ipv4) return { ok: false, error: "bootstrap logs missing IPv4", source: "bootstrap_logs" }
  return { ok: true, ipv4, source: "bootstrap_logs" }
}

export const getHostPublicIpv4 = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)

    const layout = getRepoLayout(repoRoot)
    const opentofuDir = getHostOpenTofuDir(layout, data.host)
    const deployCreds = loadDeployCreds({ cwd: repoRoot })
    const nixBin = String(deployCreds.values.NIX_BIN || "nix").trim() || "nix"

    try {
      const raw = await capture(
        nixBin,
        ["run", "--impure", "nixpkgs#opentofu", "--", "output", "-raw", "ipv4"],
        { cwd: opentofuDir, timeoutMs: 30_000, maxOutputBytes: 4096 },
      )
      const ipv4 = extractFirstIpv4(raw || "")
      if (!ipv4) return { ok: false as const, error: "opentofu output missing ipv4", source: "opentofu" }
      return { ok: true as const, ipv4, source: "opentofu" }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const fallback = await resolveBootstrapIpv4({ projectId: data.projectId, host: data.host })
      if (fallback.ok) return fallback
      return { ok: false as const, error: msg, source: "opentofu" }
    }
  })

export const probeHostTailscaleIpv4 = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostTargetInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)
    const targetHost = validateTargetHost(data.targetHost)

    try {
      const raw = await sshCapture(targetHost, "tailscale ip -4", {
        cwd: repoRoot,
        timeoutMs: 10_000,
        maxOutputBytes: 8 * 1024,
      })
      const normalized = normalizeSingleLineOutput(raw || "")
      const ipv4 = extractFirstIpv4(normalized || raw || "")
      if (!ipv4) return { ok: false as const, error: "tailscale ip missing", raw }
      if (!isTailscaleIpv4(ipv4)) return { ok: false as const, error: `unexpected IPv4 ${ipv4}`, raw }
      return { ok: true as const, ipv4 }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

export const probeSshReachability = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostTargetInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)
    const targetHost = validateTargetHost(data.targetHost)

    try {
      const raw = await sshCapture(targetHost, "hostname", {
        cwd: repoRoot,
        timeoutMs: 8_000,
        maxOutputBytes: 2 * 1024,
      })
      const hostname = normalizeSingleLineOutput(raw || "")
      return { ok: true as const, hostname: hostname || undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })
