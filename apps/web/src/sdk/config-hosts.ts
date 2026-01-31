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
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseProjectIdInput, parseProjectSshKeysInput } from "~/sdk/serverfn-validators"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"

export const addHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, host: String(d["host"] || "") }
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

export const addProjectSshKeys = createServerFn({ method: "POST" })
  .inputValidator(parseProjectSshKeysInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    if (!data.keyText.trim() && !data.knownHostsText.trim()) {
      throw new Error("no ssh keys or known_hosts entries provided")
    }
    const keysFromText = data.keyText.trim() ? parseSshPublicKeysFromText(data.keyText) : []
    const mergedKeys = Array.from(new Set([...(config.fleet.sshAuthorizedKeys || []), ...keysFromText]))

    const knownHostsFromText = data.knownHostsText.trim() ? parseKnownHostsFromText(data.knownHostsText) : []
    const mergedKnownHosts = Array.from(
      new Set([...(config.fleet.sshKnownHosts || []), ...knownHostsFromText]),
    )

    const next: ClawdletsConfig = ClawdletsConfigSchema.parse({
      ...config,
      fleet: {
        ...config.fleet,
        sshAuthorizedKeys: mergedKeys,
        sshKnownHosts: mergedKnownHosts,
      },
    })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: "project ssh keys",
    })

    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: "Updating project SSH keys" })
        await writeClawdletsConfig({ configPath, config: next })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeProjectSshAuthorizedKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, key: String(d["key"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    const key = data.key.trim()
    if (!key) throw new Error("missing key")

    const existingKeys = config.fleet.sshAuthorizedKeys || []
    if (!existingKeys.includes(key)) throw new Error("key not found")

    const next: ClawdletsConfig = ClawdletsConfigSchema.parse({
      ...config,
      fleet: {
        ...config.fleet,
        sshAuthorizedKeys: existingKeys.filter((k) => k !== key),
      },
    })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: "project ssh key rm",
    })

    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: "Removing SSH authorized key" })
        await writeClawdletsConfig({ configPath, config: next })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeProjectSshKnownHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, entry: String(d["entry"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    const entry = data.entry.trim()
    if (!entry) throw new Error("missing known_hosts entry")

    const existing = config.fleet.sshKnownHosts || []
    if (!existing.includes(entry)) throw new Error("known_hosts entry not found")

    const next: ClawdletsConfig = ClawdletsConfigSchema.parse({
      ...config,
      fleet: {
        ...config.fleet,
        sshKnownHosts: existing.filter((e) => e !== entry),
      },
    })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: "project known-host rm",
    })

    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: "Removing known_hosts entry" })
        await writeClawdletsConfig({ configPath, config: next })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })
