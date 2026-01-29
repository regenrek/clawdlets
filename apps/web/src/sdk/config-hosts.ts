import { createServerFn } from "@tanstack/react-start"
import {
  ClawdletsConfigSchema,
  type ClawdletsConfig,
  assertSafeHostName,
  loadClawdletsConfig,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"
import { parseSshPublicKeysFromText } from "@clawdlets/core/lib/ssh"
import { parseKnownHostsFromText } from "@clawdlets/core/lib/ssh-files"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseHostSshKeysInput } from "~/sdk/serverfn-validators"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"

export const addHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const host = data.host.trim()
    assertSafeHostName(host)

    const next = structuredClone(raw) as any
    next.hosts = next.hosts && typeof next.hosts === "object" && !Array.isArray(next.hosts) ? next.hosts : {}
    if (next.hosts[host]) return { ok: true as const }
    next.hosts[host] = {}
    if (!next.defaultHost) next.defaultHost = host

    const validated = ClawdletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `host add ${host}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding host ${host}` })
        await writeClawdletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const addHostSshKeys = createServerFn({ method: "POST" })
  .inputValidator(parseHostSshKeysInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    const host = data.host.trim()
    assertSafeHostName(host)
    const hostCfg = config.hosts[host]
    if (!hostCfg) throw new Error(`unknown host: ${host}`)

    if (!data.keyText.trim() && !data.knownHostsText.trim()) {
      throw new Error("no ssh keys or known_hosts entries provided")
    }
    const keysFromText = data.keyText.trim() ? parseSshPublicKeysFromText(data.keyText) : []
    const mergedKeys = Array.from(new Set([...(hostCfg.sshAuthorizedKeys || []), ...keysFromText]))

    const knownHostsFromText = data.knownHostsText.trim() ? parseKnownHostsFromText(data.knownHostsText) : []
    const mergedKnownHosts = Array.from(
      new Set([...(hostCfg.sshKnownHosts || []), ...knownHostsFromText]),
    )

    const next: ClawdletsConfig = ClawdletsConfigSchema.parse({
      ...config,
      hosts: {
        ...config.hosts,
        [host]: {
          ...hostCfg,
          sshAuthorizedKeys: mergedKeys,
          sshKnownHosts: mergedKnownHosts,
        },
      },
    })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `host ssh ${host}`,
    })

    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating SSH settings for ${host}` })
        await writeClawdletsConfig({ configPath, config: next })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeHostSshAuthorizedKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      host: String(d["host"] || ""),
      key: String(d["key"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    const host = data.host.trim()
    assertSafeHostName(host)
    const hostCfg = config.hosts[host]
    if (!hostCfg) throw new Error(`unknown host: ${host}`)

    const key = data.key.trim()
    if (!key) throw new Error("missing key")

    const existingKeys = hostCfg.sshAuthorizedKeys || []
    if (!existingKeys.includes(key)) throw new Error("key not found")

    const next: ClawdletsConfig = ClawdletsConfigSchema.parse({
      ...config,
      hosts: {
        ...config.hosts,
        [host]: {
          ...hostCfg,
          sshAuthorizedKeys: existingKeys.filter((k) => k !== key),
        },
      },
    })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `host ssh-key rm ${host}`,
    })

    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing SSH authorized key from ${host}` })
        await writeClawdletsConfig({ configPath, config: next })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeHostSshKnownHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      host: String(d["host"] || ""),
      entry: String(d["entry"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    const host = data.host.trim()
    assertSafeHostName(host)
    const hostCfg = config.hosts[host]
    if (!hostCfg) throw new Error(`unknown host: ${host}`)

    const entry = data.entry.trim()
    if (!entry) throw new Error("missing known_hosts entry")

    const existing = hostCfg.sshKnownHosts || []
    if (!existing.includes(entry)) throw new Error("known_hosts entry not found")

    const next: ClawdletsConfig = ClawdletsConfigSchema.parse({
      ...config,
      hosts: {
        ...config.hosts,
        [host]: {
          ...hostCfg,
          sshKnownHosts: existing.filter((e) => e !== entry),
        },
      },
    })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `host known-host rm ${host}`,
    })

    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing known_hosts entry from ${host}` })
        await writeClawdletsConfig({ configPath, config: next })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })
