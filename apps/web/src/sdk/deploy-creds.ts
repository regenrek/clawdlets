import path from "node:path"
import fs from "node:fs"

import { createServerFn } from "@tanstack/react-start"
import { loadDeployCreds, DEPLOY_CREDS_KEYS, renderDeployCredsEnvFile, type DeployCredsEnvFileKeys } from "@clawdlets/core/lib/deploy-creds"
import { getRepoLayout } from "@clawdlets/core/repo-layout"
import { writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { parseDotenv } from "@clawdlets/core/lib/dotenv-file"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"

async function getRepoRoot(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<string> {
  const { project } = await client.query(api.projects.get, { projectId })
  return project.localPath
}

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
  keys: DeployCredsStatusKey[]
  template: string
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
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects"> }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const loaded = loadDeployCreds({ cwd: repoRoot })

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
      keys,
      template: renderTemplate(layout.envFilePath),
    } satisfies DeployCredsStatus
  })

export const updateDeployCreds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
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

    return { projectId: d["projectId"] as Id<"projects">, updates: out }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const envPath = layout.envFilePath

    try {
      fs.mkdirSync(layout.runtimeDir, { recursive: true })
      fs.chmodSync(layout.runtimeDir, 0o700)
    } catch {
      // best-effort on platforms without POSIX perms
    }

    let existing: Record<string, string> = {}
    if (fs.existsSync(envPath)) {
      const st = fs.lstatSync(envPath)
      if (st.isSymbolicLink()) throw new Error(`refusing to read env file symlink: ${envPath}`)
      if (!st.isFile()) throw new Error(`refusing to read non-file env path: ${envPath}`)
      existing = parseDotenv(fs.readFileSync(envPath, "utf8"))
    }

    const next: DeployCredsEnvFileKeys = {
      HCLOUD_TOKEN: String(existing.HCLOUD_TOKEN || "").trim(),
      GITHUB_TOKEN: String(existing.GITHUB_TOKEN || "").trim(),
      NIX_BIN: String(existing.NIX_BIN || "nix").trim() || "nix",
      SOPS_AGE_KEY_FILE: String(existing.SOPS_AGE_KEY_FILE || "").trim(),
      ...data.updates,
    }
    next.HCLOUD_TOKEN = String(next.HCLOUD_TOKEN || "").trim()
    next.GITHUB_TOKEN = String(next.GITHUB_TOKEN || "").trim()
    next.NIX_BIN = String(next.NIX_BIN || "").trim() || "nix"
    next.SOPS_AGE_KEY_FILE = String(next.SOPS_AGE_KEY_FILE || "").trim()

    await writeFileAtomic(envPath, renderDeployCredsEnvFile(next), { mode: 0o600 })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "deployCreds.update",
      target: { envPath },
      data: {
        updatedKeys: Object.keys(data.updates),
        runtimeDir: layout.runtimeDir,
      },
    })

    return { ok: true as const }
  })
