import { createServerFn } from "@tanstack/react-start"
import {
  ClawdletsConfigSchema,
  type ClawdletsConfig,
  assertSafeHostName,
} from "@clawdlets/core/lib/clawdlets-config"
import { splitDotPath } from "@clawdlets/core/lib/dot-path"
import { deleteAtPath, getAtPath, setAtPath } from "@clawdlets/core/lib/object-path"
import { BotIdSchema } from "@clawdlets/core/lib/identifiers"
import { parseSshPublicKeysFromText } from "@clawdlets/core/lib/ssh"
import { readKnownHostsFromFile, readSshPublicKeysFromFile } from "@clawdlets/core/lib/ssh-files"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"
import { resolveUserPath } from "~/server/paths"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents } from "~/server/run-manager"

import {
  loadClawdletsConfig,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config"

type ValidationIssue = { code: string; path: Array<string | number>; message: string }

function toIssues(issues: unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    const i = issue as { code?: unknown; path?: unknown; message?: unknown }
    return {
      code: String(i.code ?? "invalid"),
      path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
      message: String(i.message ?? "Invalid"),
    }
  })
}

async function getProjectRepoRoot(client: ConvexClient, projectId: Id<"projects">) {
  const { project } = await client.query(api.projects.get, { projectId })
  return project.localPath
}

export const getClawdletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects"> }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })
    const json = JSON.stringify(config, null, 2)
    return {
      repoRoot,
      configPath,
      config: JSON.parse(json) as any,
      json,
    }
  })

export const writeClawdletsConfigFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      next: d["next"] as unknown,
      title: typeof d["title"] === "string" ? d["title"] : "Update fleet/clawdlets.json",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)

    const parsed = ClawdletsConfigSchema.safeParse(data.next)
    if (!parsed.success) return { ok: false as const, issues: toIssues(parsed.error.issues as unknown[]) }

    const { configPath } = loadClawdletsConfig({ repoRoot })
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: data.title,
    })

    try {
      await runWithEvents({
        client,
        runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: "Validating config…" })
          await emit({ level: "info", message: "Writing fleet/clawdlets.json…" })
          await writeClawdletsConfig({ configPath, config: parsed.data })
          await emit({ level: "info", message: "Done." })
        },
      })
      await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
      return { ok: true as const, runId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: message })
      return { ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[] }
    }
  })

export const configDotGet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, path: String(d["path"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
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
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })
    const parts = splitDotPath(data.path)
    const next = structuredClone(raw) as any

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
    if (!validated.success) return { ok: false as const, issues: toIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `config set ${parts.join(".")}`,
    })

    try {
      await runWithEvents({
        client,
        runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: `Updating ${parts.join(".")}` })
          await writeClawdletsConfig({ configPath, config: validated.data })
        },
      })
      await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
      return { ok: true as const, runId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: message })
      return { ok: false as const, issues: [{ code: "error", path: [], message }] satisfies ValidationIssue[] }
    }
  })

export const addHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
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
    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding host ${host}` })
        await writeClawdletsConfig({ configPath, config: validated })
      },
    })
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true as const, runId }
  })

export const addBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const parsedBot = BotIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid bot id")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.botOrder = Array.isArray(next.fleet.botOrder) ? next.fleet.botOrder : []
    next.fleet.bots = next.fleet.bots && typeof next.fleet.bots === "object" && !Array.isArray(next.fleet.bots) ? next.fleet.bots : {}
    if (next.fleet.botOrder.includes(botId) || next.fleet.bots[botId]) return { ok: true as const }
    next.fleet.botOrder = [...next.fleet.botOrder, botId]
    next.fleet.bots[botId] = { profile: { secretEnv: { DISCORD_BOT_TOKEN: `discord_token_${botId}` } } }

    const validated = ClawdletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot add ${botId}`,
    })
    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding bot ${botId}` })
        await writeClawdletsConfig({ configPath, config: validated })
      },
    })
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true as const, runId }
  })

export const removeBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const next = structuredClone(raw) as any
    const existingOrder = Array.isArray(next?.fleet?.botOrder) ? next.fleet.botOrder : []
    const existingBots = next?.fleet?.bots && typeof next.fleet.bots === "object" && !Array.isArray(next.fleet.bots) ? next.fleet.bots : {}
    if (!existingOrder.includes(botId) && !existingBots[botId]) throw new Error("bot not found")

    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.botOrder = existingOrder.filter((b: string) => b !== botId)
    const botsRecord = { ...existingBots }
    delete botsRecord[botId]
    next.fleet.bots = botsRecord
    if (Array.isArray(next.fleet.codex?.bots)) {
      next.fleet.codex.bots = next.fleet.codex.bots.filter((b: string) => b !== botId)
    }

    const validated = ClawdletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot rm ${botId}`,
    })
    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing bot ${botId}` })
        await writeClawdletsConfig({ configPath, config: validated })
      },
    })
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true as const, runId }
  })

export const addHostSshKeys = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      host: String(d["host"] || ""),
      keyText: typeof d["keyText"] === "string" ? d["keyText"] : "",
      keyFilePath: typeof d["keyFilePath"] === "string" ? d["keyFilePath"] : "",
      knownHostsFilePath: typeof d["knownHostsFilePath"] === "string" ? d["knownHostsFilePath"] : "",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { configPath, config } = loadClawdletsConfig({ repoRoot })

    const host = data.host.trim()
    assertSafeHostName(host)
    const hostCfg = config.hosts[host]
    if (!hostCfg) throw new Error(`unknown host: ${host}`)

    const keysFromText = data.keyText.trim() ? parseSshPublicKeysFromText(data.keyText) : []
    const keysFromFile = data.keyFilePath.trim()
      ? readSshPublicKeysFromFile(resolveUserPath(data.keyFilePath.trim()))
      : []
    const mergedKeys = Array.from(new Set([...(hostCfg.sshAuthorizedKeys || []), ...keysFromText, ...keysFromFile]))

    const knownHostsFromFile = data.knownHostsFilePath.trim()
      ? readKnownHostsFromFile(resolveUserPath(data.knownHostsFilePath.trim()))
      : []
    const mergedKnownHosts = Array.from(
      new Set([...(hostCfg.sshKnownHosts || []), ...knownHostsFromFile]),
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

    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating SSH settings for ${host}` })
        await writeClawdletsConfig({ configPath, config: next })
      },
    })
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true as const, runId }
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
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
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

    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing SSH authorized key from ${host}` })
        await writeClawdletsConfig({ configPath, config: next })
      },
    })
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true as const, runId }
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
    const repoRoot = await getProjectRepoRoot(client, data.projectId)
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

    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing known_hosts entry from ${host}` })
        await writeClawdletsConfig({ configPath, config: next })
      },
    })
    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true as const, runId }
  })
