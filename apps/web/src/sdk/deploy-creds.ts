import path from "node:path"
import fs from "node:fs"

import { createServerFn } from "@tanstack/react-start"
import { loadDeployCreds, DEPLOY_CREDS_KEYS, renderDeployCredsEnvFile, type DeployCredsEnvFileKeys } from "@clawdlets/core/lib/deploy-creds"
import { getRepoLayout } from "@clawdlets/core/repo-layout"
import { ensureDir, writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { parseDotenv } from "@clawdlets/core/lib/dotenv-file"
import { ageKeygen } from "@clawdlets/core/lib/age-keygen"
import { parseAgeKeyFile } from "@clawdlets/core/lib/age"
import { getLocalOperatorAgeKeyPath } from "@clawdlets/core/repo-layout"
import { sanitizeOperatorId } from "@clawdlets/shared/lib/identifiers"
import os from "node:os"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { getRepoRoot } from "~/sdk/repo-root"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export type DeployCredsStatusKey = {
  key: string
  source: "env" | "file" | "default" | "unset"
  status: "set" | "unset"
  value?: string
}

export type DeployCredsStatus = {
  repoRoot: string
  envFile:
    | null
    | {
        origin: "default" | "explicit"
        status: "ok" | "missing" | "invalid"
        path: string
        error?: string
      }
  defaultEnvPath: string
  defaultSopsAgeKeyPath: string
  keys: DeployCredsStatusKey[]
  template: string
}

type DeployCredsWriteResult = {
  envPath: string
  runtimeDir: string
  updatedKeys: string[]
}

function renderTemplate(defaultEnvPath: string): string {
  const rel = path.relative(process.cwd(), defaultEnvPath) || defaultEnvPath
  const lines = [
    "# clawdlets deploy creds (local-only; never commit)",
    "# Used by: bootstrap, infra, lockdown, doctor",
    "#",
    `# Default path: ${rel}`,
    "",
    "HCLOUD_TOKEN=",
    "GITHUB_TOKEN=",
    "NIX_BIN=nix",
    "SOPS_AGE_KEY_FILE=",
    "",
  ]
  return lines.join("\n")
}

export const getDeployCredsStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const loaded = loadDeployCreds({ cwd: repoRoot })
    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"))
    const defaultSopsAgeKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId)

    const keys: DeployCredsStatusKey[] = DEPLOY_CREDS_KEYS.map((key) => {
      const source = loaded.sources[key]
      const value = loaded.values[key]
      const isSecret = key === "HCLOUD_TOKEN" || key === "GITHUB_TOKEN"
      const status = value ? "set" : "unset"
      if (isSecret) return { key, source, status }
      return { key, source, status, value: value ? String(value) : undefined }
    })

    return {
      repoRoot,
      envFile: loaded.envFile ? { ...loaded.envFile } : null,
      defaultEnvPath: layout.envFilePath,
      defaultSopsAgeKeyPath,
      keys,
      template: renderTemplate(layout.envFilePath),
    } satisfies DeployCredsStatus
  })

export const updateDeployCreds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const updatesRaw = d["updates"]
    const updates = (!updatesRaw || typeof updatesRaw !== "object" || Array.isArray(updatesRaw))
      ? {}
      : (updatesRaw as Record<string, unknown>)

    const out: Partial<DeployCredsEnvFileKeys> = {}
    for (const k of DEPLOY_CREDS_KEYS) {
      if (!(k in updates)) continue
      const v = updates[k]
      if (typeof v !== "string") throw new Error(`invalid updates.${k}`)
      out[k] = v
    }

    return { ...base, updates: out }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const writeResult = await writeDeployCreds({ repoRoot, updates: data.updates })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "deployCreds.update",
      target: { envPath: writeResult.envPath },
      data: {
        updatedKeys: writeResult.updatedKeys,
        runtimeDir: writeResult.runtimeDir,
      },
    })

    return { ok: true as const }
  })

function readEnvFileSafe(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {}
  const st = fs.lstatSync(envPath)
  if (st.isSymbolicLink()) throw new Error(`refusing to read env file symlink: ${envPath}`)
  if (!st.isFile()) throw new Error(`refusing to read non-file env path: ${envPath}`)
  return parseDotenv(fs.readFileSync(envPath, "utf8"))
}

async function writeDeployCreds(params: { repoRoot: string; updates: Partial<DeployCredsEnvFileKeys> }): Promise<DeployCredsWriteResult> {
  const layout = getRepoLayout(params.repoRoot)
  const envPath = layout.envFilePath

  try {
    fs.mkdirSync(layout.runtimeDir, { recursive: true })
    fs.chmodSync(layout.runtimeDir, 0o700)
  } catch {
    // best-effort on platforms without POSIX perms
  }

  const existing = readEnvFileSafe(envPath)
  const next: DeployCredsEnvFileKeys = {
    HCLOUD_TOKEN: String(existing.HCLOUD_TOKEN || "").trim(),
    GITHUB_TOKEN: String(existing.GITHUB_TOKEN || "").trim(),
    NIX_BIN: String(existing.NIX_BIN || "nix").trim() || "nix",
    SOPS_AGE_KEY_FILE: String(existing.SOPS_AGE_KEY_FILE || "").trim(),
    ...params.updates,
  }
  next.HCLOUD_TOKEN = String(next.HCLOUD_TOKEN || "").trim()
  next.GITHUB_TOKEN = String(next.GITHUB_TOKEN || "").trim()
  next.NIX_BIN = String(next.NIX_BIN || "").trim() || "nix"
  next.SOPS_AGE_KEY_FILE = String(next.SOPS_AGE_KEY_FILE || "").trim()

  await writeFileAtomic(envPath, renderDeployCredsEnvFile(next), { mode: 0o600 })

  return { envPath, runtimeDir: layout.runtimeDir, updatedKeys: Object.keys(params.updates || {}) }
}

type KeyCandidate = {
  path: string
  exists: boolean
  valid: boolean
  reason?: string
}

export const detectSopsAgeKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const loaded = loadDeployCreds({ cwd: repoRoot })

    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"))
    const defaultOperatorPath = getLocalOperatorAgeKeyPath(layout, operatorId)
    const home = os.homedir()
    const homePaths = [
      path.join(home, ".config", "sops", "age", "keys.txt"),
      path.join(home, ".sops", "age", "keys.txt"),
    ]

    const candidates: string[] = []
    if (loaded.values.SOPS_AGE_KEY_FILE) candidates.push(String(loaded.values.SOPS_AGE_KEY_FILE))
    candidates.push(defaultOperatorPath)
    if (fs.existsSync(layout.localOperatorKeysDir)) {
      for (const entry of fs.readdirSync(layout.localOperatorKeysDir)) {
        if (!entry.endsWith(".agekey")) continue
        candidates.push(path.join(layout.localOperatorKeysDir, entry))
      }
    }
    for (const p of homePaths) candidates.push(p)

    const seen = new Set<string>()
    const results: KeyCandidate[] = []
    for (const candidate of candidates) {
      const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      if (!fs.existsSync(resolved)) {
        results.push({ path: resolved, exists: false, valid: false, reason: "missing" })
        continue
      }
      const st = fs.lstatSync(resolved)
      if (st.isSymbolicLink()) {
        results.push({ path: resolved, exists: true, valid: false, reason: "symlink blocked" })
        continue
      }
      if (!st.isFile()) {
        results.push({ path: resolved, exists: true, valid: false, reason: "not a file" })
        continue
      }
      const parsed = parseAgeKeyFile(fs.readFileSync(resolved, "utf8"))
      if (!parsed.secretKey) {
        results.push({ path: resolved, exists: true, valid: false, reason: "invalid key file" })
        continue
      }
      results.push({ path: resolved, exists: true, valid: true })
    }

    const preferred =
      results.find((r) => r.valid && r.path === String(loaded.values.SOPS_AGE_KEY_FILE || "")) ||
      results.find((r) => r.valid && r.path === defaultOperatorPath) ||
      results.find((r) => r.valid) ||
      null

    return {
      operatorId,
      defaultOperatorPath,
      candidates: results,
      recommendedPath: preferred?.path || null,
    }
  })

export const generateSopsAgeKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"))
    const keyPath = getLocalOperatorAgeKeyPath(layout, operatorId)
    const pubPath = `${keyPath}.pub`

    if (fs.existsSync(keyPath)) {
      return { ok: false as const, message: `key already exists: ${keyPath}` }
    }

    await ensureDir(layout.localOperatorKeysDir)
    try {
      fs.chmodSync(layout.localOperatorKeysDir, 0o700)
    } catch {
      // best-effort
    }

    const loaded = loadDeployCreds({ cwd: repoRoot })
    const nixBin = String(loaded.values.NIX_BIN || "nix").trim() || "nix"
    const keypair = await ageKeygen({ nixBin, cwd: repoRoot })

    await writeFileAtomic(keyPath, keypair.fileText, { mode: 0o600 })
    await writeFileAtomic(pubPath, `${keypair.publicKey}\n`, { mode: 0o600 })

    await writeDeployCreds({
      repoRoot,
      updates: {
        SOPS_AGE_KEY_FILE: keyPath,
      },
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "sops.operatorKey.generate",
      target: { keyPath },
      data: { operatorId },
    })

    return { ok: true as const, keyPath, publicKey: keypair.publicKey }
  })
