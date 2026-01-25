import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import { getRepoLayout, getBotWorkspaceDir } from "@clawdlets/core/repo-layout"
import { ensureDir, pathExists, writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { isFleetWorkspaceEditableDoc, FLEET_WORKSPACE_EDITABLE_DOCS } from "@clawdlets/core/lib/fleet-workspaces"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEvents } from "~/server/run-manager"
import { getRepoRoot } from "~/sdk/repo-root"

type WorkspaceDocScope = "common" | "bot" | "effective"

type WorkspaceDocListItem = {
  name: string
  hasDefault: boolean
  hasOverride: boolean
  effective: "default" | "override" | "missing"
}

type WorkspaceDocReadResult = {
  ok: true
  exists: boolean
  content: string
  sha256: string
  pathRel: string
}

type WorkspaceDocWriteResult =
  | { ok: true; runId?: Id<"runs"> }
  | { ok: false; code: "invalid" | "conflict"; message: string }

const MAX_DOC_BYTES = 256 * 1024

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function normalizeDocText(input: string): { ok: true; text: string } | { ok: false; message: string } {
  const normalized = input.replace(/\r\n/g, "\n")
  const bytes = Buffer.byteLength(normalized, "utf8")
  if (bytes > MAX_DOC_BYTES) return { ok: false, message: `doc too large (${bytes} bytes, max ${MAX_DOC_BYTES})` }
  const withNewline = normalized.endsWith("\n") ? normalized : `${normalized}\n`
  return { ok: true, text: withNewline }
}

async function readTextIfExists(filePath: string): Promise<{ exists: boolean; text: string }> {
  if (!(await pathExists(filePath))) return { exists: false, text: "" }
  const text = await fs.readFile(filePath, "utf8")
  return { exists: true, text }
}

function resolveDocPath(params: {
  repoRoot: string
  scope: WorkspaceDocScope
  botId?: string
  name: string
}): { commonPath: string; botPath: string } {
  if (!isFleetWorkspaceEditableDoc(params.name)) {
    throw new Error(`invalid doc name: ${params.name}`)
  }

  const layout = getRepoLayout(params.repoRoot)
  const commonPath = path.join(layout.fleetWorkspacesCommonDir, params.name)

  const botDir = params.botId ? getBotWorkspaceDir(layout, params.botId) : ""
  const botPath = botDir ? path.join(botDir, params.name) : ""

  if (params.scope === "bot" && !botPath) throw new Error("botId required for scope=bot")
  if (params.scope === "effective" && !botPath) throw new Error("botId required for scope=effective")

  return { commonPath, botPath }
}

export const listWorkspaceDocs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: String(d["botId"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)

    const layout = getRepoLayout(repoRoot)
    const botDir = getBotWorkspaceDir(layout, data.botId)

    const results: WorkspaceDocListItem[] = []
    for (const name of FLEET_WORKSPACE_EDITABLE_DOCS) {
      const defaultPath = path.join(layout.fleetWorkspacesCommonDir, name)
      const overridePath = path.join(botDir, name)
      const [hasDefault, hasOverride] = await Promise.all([pathExists(defaultPath), pathExists(overridePath)])
      results.push({
        name,
        hasDefault,
        hasOverride,
        effective: hasOverride ? "override" : hasDefault ? "default" : "missing",
      })
    }

    return {
      repoRoot,
      docs: results,
    }
  })

export const readWorkspaceDoc = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    const scope = String(d["scope"] || "")
    if (scope !== "common" && scope !== "bot" && scope !== "effective") throw new Error("invalid scope")
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: typeof d["botId"] === "string" ? d["botId"] : "",
      scope: scope as WorkspaceDocScope,
      name: String(d["name"] || ""),
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocReadResult> => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)

    const { commonPath, botPath } = resolveDocPath({
      repoRoot,
      scope: data.scope,
      botId: data.botId || undefined,
      name: data.name,
    })

    const layout = getRepoLayout(repoRoot)
    const chosen =
      data.scope === "common"
        ? commonPath
        : data.scope === "bot"
          ? botPath
          : (await pathExists(botPath)) ? botPath : commonPath

    const rel = path.relative(layout.repoRoot, chosen)
    const r = await readTextIfExists(chosen)
    return {
      ok: true,
      exists: r.exists,
      content: r.text,
      sha256: r.exists ? sha256Hex(r.text) : "",
      pathRel: rel,
    }
  })

export const writeWorkspaceDoc = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    const scope = String(d["scope"] || "")
    if (scope !== "common" && scope !== "bot") throw new Error("invalid scope")
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: typeof d["botId"] === "string" ? d["botId"] : "",
      scope: scope as Exclude<WorkspaceDocScope, "effective">,
      name: String(d["name"] || ""),
      content: typeof d["content"] === "string" ? d["content"] : "",
      expectedSha256: typeof d["expectedSha256"] === "string" ? d["expectedSha256"] : "",
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocWriteResult> => {
    const normalized = normalizeDocText(data.content)
    if (!normalized.ok) return { ok: false, code: "invalid", message: normalized.message }

    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)

    const { commonPath, botPath } = resolveDocPath({
      repoRoot,
      scope: data.scope,
      botId: data.botId || undefined,
      name: data.name,
    })
    const targetPath = data.scope === "common" ? commonPath : botPath

    if (data.expectedSha256.trim()) {
      const existing = await readTextIfExists(targetPath)
      if (existing.exists) {
        const actual = sha256Hex(existing.text)
        if (actual !== data.expectedSha256.trim()) {
          return { ok: false, code: "conflict", message: "file changed on disk (reload and retry)" }
        }
      }
    }

    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "workspace_write",
      title: data.scope === "common" ? `workspace write common/${data.name}` : `workspace write bots/${data.botId}/${data.name}`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: data.scope === "common" ? "workspace.common.write" : "workspace.bot.write",
      target: data.scope === "common" ? { doc: data.name } : { botId: data.botId, doc: data.name },
      data: { runId },
    })

    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Writing ${path.relative(layout.repoRoot, targetPath)}` })
        await ensureDir(path.dirname(targetPath))
        await writeFileAtomic(targetPath, normalized.text)
        await emit({ level: "info", message: "Done." })
      },
    })

    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true, runId }
  })

export const resetWorkspaceDocOverride = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
      botId: String(d["botId"] || ""),
      name: String(d["name"] || ""),
      expectedSha256: typeof d["expectedSha256"] === "string" ? d["expectedSha256"] : "",
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocWriteResult> => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)

    const { botPath } = resolveDocPath({
      repoRoot,
      scope: "bot",
      botId: data.botId,
      name: data.name,
    })

    const exists = await pathExists(botPath)
    if (!exists) {
      return { ok: true }
    }

    if (data.expectedSha256.trim()) {
      const existing = await readTextIfExists(botPath)
      if (existing.exists) {
        const actual = sha256Hex(existing.text)
        if (actual !== data.expectedSha256.trim()) {
          return { ok: false, code: "conflict", message: "file changed on disk (reload and retry)" }
        }
      }
    }

    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "workspace_write",
      title: `workspace reset bots/${data.botId}/${data.name}`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "workspace.bot.reset",
      target: { botId: data.botId, doc: data.name },
      data: { runId },
    })

    await runWithEvents({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Resetting ${path.relative(layout.repoRoot, botPath)}` })
        const { default: trash } = await import("trash")
        await trash([botPath])
        await emit({ level: "info", message: "Moved to trash." })
      },
    })

    await client.mutation(api.runs.setStatus, { runId, status: "succeeded" })
    return { ok: true, runId }
  })
