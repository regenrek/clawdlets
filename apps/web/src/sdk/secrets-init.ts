import fs from "node:fs/promises"
import path from "node:path"

import { createServerFn } from "@tanstack/react-start"
import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets-plan"
import {
  buildSecretsInitTemplate,
  isPlaceholderSecretValue,
  type SecretsInitJson,
} from "@clawdlets/core/lib/secrets-init"
import { buildSecretsInitTemplateSets } from "@clawdlets/core/lib/secrets-init-template"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import { getRepoLayout, getHostSecretFile } from "@clawdlets/core/repo-layout"
import { assertSecretsAreManaged, buildManagedHostSecretNameAllowlist } from "@clawdlets/core/lib/secrets-allowlist"
import { writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { mkpasswdYescryptHash } from "@clawdlets/core/lib/mkpasswd"
import { sopsDecryptYamlFile } from "@clawdlets/core/lib/sops"
import { readYamlScalarFromMapping } from "@clawdlets/core/lib/yaml-scalar"
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { resolveClawdletsCliEntry } from "~/server/clawdlets-cli"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { getClawdletsCliEnv } from "~/server/run-env"
import { runWithEvents, spawnCommand } from "~/server/run-manager"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseProjectHostInput, parseSecretsInitExecuteInput } from "~/sdk/serverfn-validators"
import { resolveHostFromConfig } from "~/sdk/secrets-helpers"
import { requireAdminAndBoundRun } from "~/sdk/run-guards"

export const getSecretsTemplate = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const host = resolveHostFromConfig(config, data.host, { requireKnownHost: true })

    const hostCfg = config.hosts[host]

    const secretsPlan = buildFleetSecretsPlan({ config, hostName: host })
    const sets = buildSecretsInitTemplateSets({ secretsPlan, hostCfg })
    const template = buildSecretsInitTemplate({ requiresTailscaleAuthKey: sets.requiresTailscaleAuthKey, secrets: sets.templateSecrets })

    return {
      host,
      bots: secretsPlan.bots,
      secretsPlan,
      missingSecretConfig: secretsPlan.missing,
      requiredSecretNames: sets.requiredSecretNames,
      templateJson: `${JSON.stringify(template, null, 2)}\n`,
    }
  })

export const secretsInitStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    const host = resolveHostFromConfig(config, data.host, { requireKnownHost: true })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "secrets_init",
      title: `Secrets init (${host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.init",
      target: { host },
      data: { runId },
    })
    await client.mutation(api.runEvents.appendBatch, {
      runId,
      events: [{ ts: Date.now(), level: "info", message: "Starting secrets init…" }],
    })
    return { runId }
  })

export const secretsInitExecute = createServerFn({ method: "POST" })
  .inputValidator(parseSecretsInitExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const guard = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "secrets_init",
    })

    const repoRoot = guard.repoRoot
    let tmpJsonPath = ""
    let redactTokens: string[] = []
    try {
      const { config } = loadClawdletsConfig({ repoRoot })
      if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)
      const layout = getRepoLayout(repoRoot)

      const allowlist = buildManagedHostSecretNameAllowlist({ config, host: data.host })
      assertSecretsAreManaged({ allowlist, secrets: data.secrets })

      const baseRedactions = await readClawdletsEnvTokens(repoRoot)
      const extraRedactions = [
        data.adminPassword,
        data.adminPasswordHash,
        data.tailscaleAuthKey,
        ...Object.values(data.secrets || {}),
      ]
        .map((s) => String(s || "").trim())
        .filter(Boolean)

      redactTokens = Array.from(new Set([...baseRedactions, ...extraRedactions]))

      const cliEntry = resolveClawdletsCliEntry()
      const cliEnv = getClawdletsCliEnv()
      tmpJsonPath = path.join(
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
        ...(data.tailscaleAuthKey.trim() ? { tailscaleAuthKey: data.tailscaleAuthKey.trim() } : {}),
        secrets: data.secrets,
      }

      await writeFileAtomic(tmpJsonPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })

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
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
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
      if (tmpJsonPath) {
        try {
          await fs.rm(tmpJsonPath, { force: true })
        } catch {
          // ignore
        }
      }
    }
  })
