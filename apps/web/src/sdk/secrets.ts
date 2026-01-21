import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"

import { createServerFn } from "@tanstack/react-start"
import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets"
import {
  buildSecretsInitTemplate,
  isPlaceholderSecretValue,
  type SecretsInitJson,
} from "@clawdlets/core/lib/secrets-init"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import {
  getRepoLayout,
  getHostRemoteSecretsDir,
  getHostExtraFilesKeyPath,
  getHostExtraFilesSecretsDir,
  getHostEncryptedAgeKeyFile,
  getHostSecretFile,
  getHostSecretsDir,
} from "@clawdlets/core/repo-layout"
import { writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { mkpasswdYescryptHash } from "@clawdlets/core/lib/mkpasswd"
import { createSecretsTar } from "@clawdlets/core/lib/secrets-tar"
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdlets/core/lib/sops"
import { readYamlScalarFromMapping, upsertYamlScalarLine } from "@clawdlets/core/lib/yaml-scalar"
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents, spawnCommand, spawnCommandCapture } from "~/server/run-manager"

async function getRepoRoot(
  client: ConvexClient,
  projectId: Id<"projects">,
) {
  const { project } = await client.query(api.projects.get, { projectId })
  return project.localPath
}

export const getSecretsTemplate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const host = data.host.trim() || config.defaultHost || ""
    if (!host) throw new Error("missing host")

    const hostCfg = config.hosts[host]
    if (!hostCfg) throw new Error(`unknown host: ${host}`)

    const secretsPlan = buildFleetSecretsPlan({ config, hostName: host })
    const requiredSecretNames = new Set<string>(secretsPlan.secretNamesRequired)

    const tailnetMode = String(hostCfg.tailnet?.mode || "none")
    const requiresTailscaleAuthKey = tailnetMode === "tailscale"

    const garnixPrivate = hostCfg.cache?.garnix?.private
    const garnixPrivateEnabled = Boolean(garnixPrivate?.enable)
    const garnixNetrcSecretName = garnixPrivateEnabled
      ? String(garnixPrivate?.netrcSecret || "garnix_netrc").trim()
      : ""
    if (garnixPrivateEnabled && !garnixNetrcSecretName) {
      throw new Error("cache.garnix.private.netrcSecret must be set when private cache is enabled")
    }

    const discordBotsRequired = secretsPlan.bots.filter((b) => {
      const secretName = secretsPlan.discordSecretsByBot[b] || ""
      return secretName && requiredSecretNames.has(secretName)
    })

    const discordSecretNames = new Set<string>(Object.values(secretsPlan.discordSecretsByBot).filter(Boolean))
    const fleetModelSecretNames = new Set<string>(
      Object.values((config.fleet.modelSecrets || {}) as Record<string, string>)
        .map((s) => String(s || "").trim())
        .filter(Boolean),
    )

    const templateExtraSecrets: Record<string, string> = {}
    for (const secretName of secretsPlan.secretNamesAll) {
      if (discordSecretNames.has(secretName)) continue
      if (fleetModelSecretNames.has(secretName)) continue
      templateExtraSecrets[secretName] = requiredSecretNames.has(secretName)
        ? "<REPLACE_WITH_SECRET>"
        : "<OPTIONAL>"
    }
    if (garnixPrivateEnabled) {
      templateExtraSecrets[garnixNetrcSecretName] = "<REPLACE_WITH_NETRC>"
    }

    const template = buildSecretsInitTemplate({
      bots: secretsPlan.bots,
      discordBots: discordBotsRequired,
      requiresTailscaleAuthKey,
      secrets: templateExtraSecrets,
    })

    return {
      host,
      bots: secretsPlan.bots,
      missingSecretConfig: secretsPlan.missingSecretConfig,
      requiredSecretNames: secretsPlan.secretNamesRequired,
      templateJson: `${JSON.stringify(template, null, 2)}\n`,
    }
  })

export const secretsInitStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "secrets_init",
      title: `Secrets init (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.init",
      target: { host: data.host },
      data: { runId },
    })
    await client.mutation(api.runEvents.appendBatch, {
      runId,
      events: [{ ts: Date.now(), level: "info", message: "Starting secrets init…" }],
    })
    return { runId }
  })

export const secretsInitExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      runId: d["runId"] as Id<"runs">,
      host: String(d["host"] || ""),
      allowPlaceholders: Boolean(d["allowPlaceholders"]),
      adminPassword: typeof d["adminPassword"] === "string" ? d["adminPassword"] : "",
      adminPasswordHash: typeof d["adminPasswordHash"] === "string" ? d["adminPasswordHash"] : "",
      tailscaleAuthKey: typeof d["tailscaleAuthKey"] === "string" ? d["tailscaleAuthKey"] : "",
      discordTokens: (d["discordTokens"] || {}) as Record<string, string>,
      secrets: (d["secrets"] || {}) as Record<string, string>,
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)

    const baseRedactions = await readClawdletsEnvTokens(repoRoot)
    const extraRedactions = [
      data.adminPassword,
      data.adminPasswordHash,
      data.tailscaleAuthKey,
      ...Object.values(data.discordTokens || {}),
      ...Object.values(data.secrets || {}),
    ]
      .map((s) => String(s || "").trim())
      .filter(Boolean)

    const redactTokens = Array.from(new Set([...baseRedactions, ...extraRedactions]))

    const cliEntry = resolveClawdletsCliEntry()
    const tmpJsonPath = path.join(
      repoRoot,
      ".clawdlets",
      `secrets.ui.${Date.now()}.${process.pid}.json`,
    )

    let adminPasswordHash = data.adminPasswordHash.trim()
    if (!adminPasswordHash && data.adminPassword.trim()) {
      await runWithEvents({
        client,
        runId: data.runId,
        redactTokens,
        fn: async (emit) => {
          await emit({ level: "info", message: "Generating admin password hash (yescrypt)…" })
        },
      })
      adminPasswordHash = await mkpasswdYescryptHash(data.adminPassword, {
        nixBin: String(process.env.NIX_BIN || "nix").trim() || "nix",
        cwd: repoRoot,
        dryRun: false,
        redact: [data.adminPassword],
      })
    }
    if (!adminPasswordHash) {
      const loaded = loadDeployCreds({ cwd: repoRoot })
      const ageKeyFile = String(loaded.values.SOPS_AGE_KEY_FILE || "").trim()
      if (!ageKeyFile) throw new Error("missing SOPS_AGE_KEY_FILE (needed to read existing admin_password_hash)")

      const hostSecretPath = getHostSecretFile(layout, data.host, "admin_password_hash")
      const nix = { nixBin: String(loaded.values.NIX_BIN || "nix").trim() || "nix", cwd: repoRoot, dryRun: false } as const
      try {
        const decrypted = await sopsDecryptYamlFile({
          filePath: hostSecretPath,
          ageKeyFile,
          nix,
        })
        const existing = readYamlScalarFromMapping({ yamlText: decrypted, key: "admin_password_hash" })?.trim() || ""
        if (existing && !isPlaceholderSecretValue(existing)) adminPasswordHash = existing
      } catch {
        // ignore; fall through to placeholder handling below
      }

      if (!adminPasswordHash) {
        if (data.allowPlaceholders) adminPasswordHash = "<FILL_ME>"
        else throw new Error("admin password required (set Admin password or allow placeholders)")
      }
    }

    const payload: SecretsInitJson = {
      adminPasswordHash,
      discordTokens: Object.fromEntries(
        Object.entries(data.discordTokens || {})
          .map(([k, v]) => [String(k).trim(), String(v).trim()] as const)
          .filter(([, v]) => v),
      ),
      ...(data.tailscaleAuthKey.trim() ? { tailscaleAuthKey: data.tailscaleAuthKey.trim() } : {}),
      ...(data.secrets && Object.keys(data.secrets).length > 0 ? { secrets: data.secrets } : {}),
    }

    await writeFileAtomic(tmpJsonPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })

    try {
      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args: [
          cliEntry,
          "secrets",
          "init",
          "--host",
          data.host,
          "--from-json",
          tmpJsonPath,
          "--yes",
          ...(data.allowPlaceholders ? ["--allow-placeholders"] : []),
        ],
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, { runId: data.runId, status: "succeeded" })
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: "failed",
        errorMessage: message,
      })
      return { ok: false as const, message }
    } finally {
      try {
        await fs.rm(tmpJsonPath, { force: true })
      } catch {
        // ignore
      }
    }
  })

export const secretsVerifyStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "secrets_verify",
      title: `Secrets verify (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.verify",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const secretsVerifyExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      runId: d["runId"] as Id<"runs">,
      host: String(d["host"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const cliEntry = resolveClawdletsCliEntry()

    try {
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

export const secretsSyncStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "secrets_sync",
      title: `Secrets sync (${data.host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.sync",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const secretsSyncPreview = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects">, host: String(d["host"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const host = data.host.trim() || config.defaultHost || ""
    if (!host) throw new Error("missing host")

    const layout = getRepoLayout(repoRoot)
    const localDir = getHostSecretsDir(layout, host)
    const remoteDir = getHostRemoteSecretsDir(host)

    let tarPath = ""
    try {
      const created = await createSecretsTar({ hostName: host, localDir })
      tarPath = created.tarPath
      return {
        ok: true as const,
        localDir,
        remoteDir,
        digest: created.digest,
        files: created.files,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, localDir, remoteDir, message }
    } finally {
      if (tarPath) {
        try {
          await fs.rm(tarPath, { force: true })
        } catch {
          // ignore
        }
      }
    }
  })

export const secretsSyncExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      runId: d["runId"] as Id<"runs">,
      host: String(d["host"] || ""),
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
        args: [cliEntry, "secrets", "sync", "--host", data.host, "--ssh-tty=false"],
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: "succeeded",
      })
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: "failed",
        errorMessage: message,
      })
      return { ok: false as const, message }
    }
  })

export const writeHostSecrets = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    if (!d["secrets"] || typeof d["secrets"] !== "object" || Array.isArray(d["secrets"])) {
      throw new Error("invalid secrets")
    }
    const secrets: Record<string, string> = {}
    for (const [k, v] of Object.entries(d["secrets"] as Record<string, unknown>)) {
      if (typeof v !== "string") continue
      const key = String(k || "").trim()
      const value = v.trim()
      if (!key || !value) continue
      secrets[key] = value
    }
    return {
      projectId: d["projectId"] as Id<"projects">,
      host: String(d["host"] || ""),
      secrets,
    }
  })
  .handler(async ({ data }) => {
    const host = data.host.trim()
    if (!host) throw new Error("missing host")

    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)

    const layout = getRepoLayout(repoRoot)
    if (!fsSync.existsSync(layout.sopsConfigPath)) {
      throw new Error("missing sops config (run Secrets → Init for this host first)")
    }
    if (!fsSync.existsSync(getHostEncryptedAgeKeyFile(layout, host))) {
      throw new Error("missing host age key (run Secrets → Init for this host first)")
    }
    if (!fsSync.existsSync(getHostExtraFilesKeyPath(layout, host))) {
      throw new Error("missing extra-files key (run Secrets → Init for this host first)")
    }

    const loaded = loadDeployCreds({ cwd: repoRoot })
    const nix = { nixBin: String(loaded.values.NIX_BIN || "nix").trim() || "nix", cwd: repoRoot, dryRun: false } as const

    const extraFilesSecretsDir = getHostExtraFilesSecretsDir(layout, host)
    const updated: string[] = []

    for (const [secretName, secretValue] of Object.entries(data.secrets)) {
      const outPath = getHostSecretFile(layout, host, secretName)
      const plaintextYaml = upsertYamlScalarLine({ text: "\n", key: secretName, value: secretValue }) + "\n"
      await sopsEncryptYamlToFile({ plaintextYaml, outPath, configPath: layout.sopsConfigPath, nix })
      const encrypted = await fs.readFile(outPath, "utf8")
      await writeFileAtomic(path.join(extraFilesSecretsDir, `${secretName}.yaml`), encrypted, { mode: 0o400 })
      updated.push(secretName)
    }

    if (updated.length > 0) {
      await client.mutation(api.auditLogs.append, {
        projectId: data.projectId,
        action: "secrets.write",
        target: { host },
        data: { secrets: updated },
      })
    }

    return { ok: true as const, updated }
  })
