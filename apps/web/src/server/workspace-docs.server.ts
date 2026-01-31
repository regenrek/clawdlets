import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

import { getRepoLayout, getBotWorkspaceDir } from "@clawdlets/core/repo-layout"
import { ensureDir, pathExists, writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { isFleetWorkspaceEditableDoc, FLEET_WORKSPACE_EDITABLE_DOCS } from "@clawdlets/core/lib/fleet-workspaces"
import { moveToTrash } from "@clawdlets/core/lib/fs-trash"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"
import { getRepoRoot } from "~/sdk/repo-root"
import type {
  WorkspaceDocListItem,
  WorkspaceDocReadResult,
  WorkspaceDocScope,
  WorkspaceDocWriteResult,
  WorkspaceDocWriteScope,
} from "~/sdk/workspace-docs-model"

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

export async function listWorkspaceDocsServer(params: {
  projectId: Id<"projects">
  botId: string
}): Promise<{ repoRoot: string; docs: WorkspaceDocListItem[] }> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)

  const layout = getRepoLayout(repoRoot)
  const botDir = getBotWorkspaceDir(layout, params.botId)

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
}

export async function readWorkspaceDocServer(params: {
  projectId: Id<"projects">
  botId: string
  scope: WorkspaceDocScope
  name: string
}): Promise<WorkspaceDocReadResult> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)

  const { commonPath, botPath } = resolveDocPath({
    repoRoot,
    scope: params.scope,
    botId: params.botId || undefined,
    name: params.name,
  })

  const layout = getRepoLayout(repoRoot)
  const chosen =
    params.scope === "common"
      ? commonPath
      : params.scope === "bot"
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
}

export async function writeWorkspaceDocServer(params: {
  projectId: Id<"projects">
  botId: string
  scope: WorkspaceDocWriteScope
  name: string
  content: string
  expectedSha256: string
}): Promise<WorkspaceDocWriteResult> {
  const normalized = normalizeDocText(params.content)
  if (!normalized.ok) return { ok: false, code: "invalid", message: normalized.message }

  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)
  const layout = getRepoLayout(repoRoot)

  const { commonPath, botPath } = resolveDocPath({
    repoRoot,
    scope: params.scope,
    botId: params.botId || undefined,
    name: params.name,
  })
  const targetPath = params.scope === "common" ? commonPath : botPath

  if (params.expectedSha256.trim()) {
    const existing = await readTextIfExists(targetPath)
    if (existing.exists) {
      const actual = sha256Hex(existing.text)
      if (actual !== params.expectedSha256.trim()) {
        return { ok: false, code: "conflict", message: "file changed on disk (reload and retry)" }
      }
    }
  }

  const redactTokens = await readClawdletsEnvTokens(repoRoot)
  const { runId } = await client.mutation(api.runs.create, {
    projectId: params.projectId,
    kind: "workspace_write",
    title:
      params.scope === "common"
        ? `workspace write common/${params.name}`
        : `workspace write bots/${params.botId}/${params.name}`,
  })

  return await runWithEventsAndStatus({
    client,
    runId,
    redactTokens,
    fn: async (emit) => {
      await emit({ level: "info", message: `Writing ${path.relative(layout.repoRoot, targetPath)}` })
      await ensureDir(path.dirname(targetPath))
      await writeFileAtomic(targetPath, normalized.text)
      await emit({ level: "info", message: "Done." })
    },
    onAfterEvents: async () => {
      await client.mutation(api.auditLogs.append, {
        projectId: params.projectId,
        action: params.scope === "common" ? "workspace.common.write" : "workspace.bot.write",
        target: params.scope === "common" ? { doc: params.name } : { botId: params.botId, doc: params.name },
        data: { runId },
      })
    },
    onSuccess: () => ({ ok: true as const, runId }),
  })
}

export async function resetWorkspaceDocOverrideServer(params: {
  projectId: Id<"projects">
  botId: string
  name: string
  expectedSha256: string
}): Promise<WorkspaceDocWriteResult> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)
  const layout = getRepoLayout(repoRoot)

  const { botPath } = resolveDocPath({
    repoRoot,
    scope: "bot",
    botId: params.botId,
    name: params.name,
  })

  const exists = await pathExists(botPath)
  if (!exists) {
    return { ok: true }
  }

  if (params.expectedSha256.trim()) {
    const existing = await readTextIfExists(botPath)
    if (existing.exists) {
      const actual = sha256Hex(existing.text)
      if (actual !== params.expectedSha256.trim()) {
        return { ok: false, code: "conflict", message: "file changed on disk (reload and retry)" }
      }
    }
  }

  const redactTokens = await readClawdletsEnvTokens(repoRoot)
  const { runId } = await client.mutation(api.runs.create, {
    projectId: params.projectId,
    kind: "workspace_write",
    title: `workspace reset bots/${params.botId}/${params.name}`,
  })

  return await runWithEventsAndStatus({
    client,
    runId,
    redactTokens,
    fn: async (emit) => {
      await emit({ level: "info", message: `Resetting ${path.relative(layout.repoRoot, botPath)}` })
      await moveToTrash(botPath)
      await emit({ level: "info", message: "Moved to trash." })
    },
    onAfterEvents: async () => {
      await client.mutation(api.auditLogs.append, {
        projectId: params.projectId,
        action: "workspace.bot.reset",
        target: { botId: params.botId, doc: params.name },
        data: { runId },
      })
    },
    onSuccess: () => ({ ok: true as const, runId }),
  })
}
