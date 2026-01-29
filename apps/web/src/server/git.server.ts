import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { spawnCommandCapture } from "~/server/run-manager"
import { capture } from "@clawdlets/core/lib/run"
import { getAdminProjectContext, getRepoRoot } from "~/sdk/repo-root"
import { sanitizeErrorMessage } from "@clawdlets/core/lib/safe-error"

export type GitRepoStatus = {
  branch: string | null
  upstream: string | null
  localHead: string | null
  originDefaultRef: string | null
  originHead: string | null
  dirty: boolean
  ahead: number | null
  behind: number | null
  detached: boolean
  needsPush: boolean
  canPush: boolean
  pushBlockedReason?: string
}

type StatusCacheEntry = {
  expiresAt: number
  value: GitRepoStatus
}

const STATUS_CACHE_TTL_MS = 3_000
const STATUS_FAILURE_TTL_MS = 5_000
const STATUS_CACHE_MAX = 64
const GIT_CAPTURE_TIMEOUT_MS = 6_000
const GIT_CAPTURE_MAX_OUTPUT_BYTES = 1_000_000
const statusCache = new Map<string, StatusCacheEntry>()
const statusInFlight = new Map<string, Promise<GitRepoStatus>>()
const statusFailureCache = new Map<string, { expiresAt: number; message: string }>()
const pushInFlight = new Map<string, Promise<{ ok: boolean; runId: Id<"runs"> }>>()

function pruneExpired<T extends { expiresAt: number }>(cache: Map<string, T>, now: number) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

function capCache<T>(cache: Map<string, T>, maxSize: number) {
  if (cache.size <= maxSize) return
  const excess = cache.size - maxSize
  let removed = 0
  for (const key of cache.keys()) {
    cache.delete(key)
    removed += 1
    if (removed >= excess) break
  }
}

export const __test_gitStatusCache = {
  clear() {
    statusCache.clear()
    statusInFlight.clear()
    statusFailureCache.clear()
  },
  ttlMs: STATUS_CACHE_TTL_MS,
  failureTtlMs: STATUS_FAILURE_TTL_MS,
}

function parsePorcelainStatus(raw: string): {
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  detached: boolean
  localHead: string | null
  dirty: boolean
} {
  let branch: string | null = null
  let upstream: string | null = null
  let ahead: number | null = null
  let behind: number | null = null
  let detached = false
  let localHead: string | null = null
  let dirty = false

  let cursor = 0
  while (cursor < raw.length) {
    const newlineIndex = raw.indexOf("\n", cursor)
    const nextCursor = newlineIndex === -1 ? raw.length : newlineIndex + 1
    const line = raw.slice(cursor, newlineIndex === -1 ? raw.length : newlineIndex).trimEnd()
    cursor = nextCursor
    if (!line) continue
    if (!line.startsWith("#")) {
      dirty = true
      break
    }
    const payload = line.slice(1).trimStart()
    if (payload.startsWith("branch.oid")) {
      const oid = payload.replace(/^branch\.oid\s+/, "").trim()
      if (oid && !oid.startsWith("(")) localHead = oid
    } else if (payload.startsWith("branch.head")) {
      const head = payload.replace(/^branch\.head\s+/, "").trim()
      if (head.startsWith("(")) {
        detached = true
        branch = "HEAD"
      } else {
        branch = head || null
      }
    } else if (payload.startsWith("branch.upstream")) {
      upstream = payload.replace(/^branch\.upstream\s+/, "").trim() || null
    } else if (payload.startsWith("branch.ab")) {
      const tokens = payload.replace(/^branch\.ab\s+/, "").trim().split(/\s+/)
      for (const token of tokens) {
        if (token.startsWith("+")) ahead = Number(token.slice(1))
        if (token.startsWith("-")) behind = Number(token.slice(1))
      }
    }
  }

  return { branch, upstream, ahead, behind, detached, localHead, dirty }
}

export function __test_parsePorcelainStatus(raw: string) {
  return parsePorcelainStatus(raw)
}

async function readOriginHeadFromRefs(repoRoot: string, env: Record<string, string | undefined>) {
  try {
    const output = await capture(
      "git",
      ["for-each-ref", "--format", "%(refname:short) %(objectname)", "refs/remotes/origin/HEAD"],
      {
        cwd: repoRoot,
        env,
        timeoutMs: GIT_CAPTURE_TIMEOUT_MS,
        maxOutputBytes: GIT_CAPTURE_MAX_OUTPUT_BYTES,
      },
    )
    const line = output.trim()
    if (!line) return { originDefaultRef: null, originHead: null }
    const [ref, oid] = line.split(/\s+/, 2)
    return { originDefaultRef: ref || null, originHead: oid || null }
  } catch {
    return { originDefaultRef: null, originHead: null }
  }
}

async function readOriginDefaultRefFromRemoteShow(repoRoot: string, env: Record<string, string | undefined>) {
  try {
    const remoteShow = await capture("git", ["remote", "show", "-n", "origin"], {
      cwd: repoRoot,
      env,
      timeoutMs: GIT_CAPTURE_TIMEOUT_MS,
      maxOutputBytes: GIT_CAPTURE_MAX_OUTPUT_BYTES,
    })
    const match = remoteShow.match(/HEAD branch:\s+([^\s]+)/)
    if (match?.[1]) return `origin/${match[1]}`
  } catch {
    return null
  }
  return null
}

export async function readGitStatus(repoRoot: string): Promise<GitRepoStatus> {
  const now = Date.now()
  pruneExpired(statusCache, now)
  pruneExpired(statusFailureCache, now)
  const cached = statusCache.get(repoRoot)
  if (cached && cached.expiresAt > now) return cached.value
  const failureCached = statusFailureCache.get(repoRoot)
  if (failureCached && failureCached.expiresAt > now) throw new Error(failureCached.message)
  const inflight = statusInFlight.get(repoRoot)
  if (inflight) return inflight

  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  const task = (async () => {
    try {
      const statusRaw = await capture("git", ["status", "--porcelain=v2", "-b"], {
        cwd: repoRoot,
        env,
        timeoutMs: GIT_CAPTURE_TIMEOUT_MS,
        maxOutputBytes: GIT_CAPTURE_MAX_OUTPUT_BYTES,
      })
      const parsed = parsePorcelainStatus(statusRaw)
      const dirty = parsed.dirty
      const localHead = parsed.localHead

      const hasUpstream = Boolean(parsed.upstream)
      let originRemote = hasUpstream

      let originDefaultRef: string | null = null
      let originHead: string | null = null
      const originInfo = await readOriginHeadFromRefs(repoRoot, env)
      if (originInfo.originDefaultRef) {
        originDefaultRef = originInfo.originDefaultRef
        originHead = originInfo.originHead
        originRemote = true
      }

      if (!originDefaultRef && (hasUpstream || originRemote)) {
        originDefaultRef = await readOriginDefaultRefFromRemoteShow(repoRoot, env)
        if (originDefaultRef) {
          originRemote = true
          try {
            originHead = await capture("git", ["rev-parse", originDefaultRef], {
              cwd: repoRoot,
              env,
              timeoutMs: GIT_CAPTURE_TIMEOUT_MS,
              maxOutputBytes: GIT_CAPTURE_MAX_OUTPUT_BYTES,
            })
          } catch {
            originHead = null
          }
        }
      }

      if (!originRemote && !hasUpstream) {
        try {
          const originUrl = await capture("git", ["config", "--get", "remote.origin.url"], {
            cwd: repoRoot,
            env,
            timeoutMs: GIT_CAPTURE_TIMEOUT_MS,
            maxOutputBytes: GIT_CAPTURE_MAX_OUTPUT_BYTES,
          })
          originRemote = Boolean(originUrl.trim())
        } catch {
          originRemote = false
        }
      }

      const needsPush = !parsed.detached && (hasUpstream ? (parsed.ahead ?? 0) > 0 : true)
      const canPush = !parsed.detached && Boolean(parsed.branch) && (hasUpstream || originRemote)
      let pushBlockedReason: string | undefined
      if (parsed.detached) pushBlockedReason = "Detached HEAD; checkout a branch to push."
      else if (!parsed.branch) pushBlockedReason = "Unknown branch."
      else if (!hasUpstream && !originRemote) pushBlockedReason = "Missing origin remote."

      const result = {
        branch: parsed.branch,
        upstream: parsed.upstream,
        localHead,
        originDefaultRef,
        originHead,
        dirty,
        ahead: parsed.ahead,
        behind: parsed.behind,
        detached: parsed.detached,
        needsPush,
        canPush,
        pushBlockedReason,
      }

      const expiresAt = Date.now() + STATUS_CACHE_TTL_MS
      statusCache.set(repoRoot, { expiresAt, value: result })
      capCache(statusCache, STATUS_CACHE_MAX)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const expiresAt = Date.now() + STATUS_FAILURE_TTL_MS
      statusFailureCache.set(repoRoot, { expiresAt, message })
      capCache(statusFailureCache, STATUS_CACHE_MAX)
      throw err
    }
  })()

  statusInFlight.set(repoRoot, task)
  task.finally(() => statusInFlight.delete(repoRoot)).catch(() => {})
  return task
}

export async function fetchGitRepoStatus(params: { projectId: Id<"projects"> }) {
  try {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, params.projectId)
    return await readGitStatus(repoRoot)
  } catch (err) {
    const message = sanitizeErrorMessage(err, "Unable to read git status.")
    console.error("fetchGitRepoStatus failed", message)
    throw new Error(message)
  }
}

export async function executeGitPush(params: { projectId: Id<"projects"> }) {
  const client = createConvexClient()
  const context = await getAdminProjectContext(client, params.projectId)
  const repoRoot = context.repoRoot

  const inflight = pushInFlight.get(repoRoot)
  if (inflight) return await inflight

  const task = (async () => {
    let runId: Id<"runs"> | null = null
    try {
      const status = await readGitStatus(repoRoot)
      if (!status.canPush) throw new Error(status.pushBlockedReason || "cannot push from this repo")
      if (status.detached || !status.branch) throw new Error("detached HEAD; checkout a branch")

      const run = await client.mutation(api.runs.create, {
        projectId: params.projectId,
        kind: "custom",
        title: `Git push (${status.branch})`,
      })
      runId = run.runId

      const redactTokens = await readClawdletsEnvTokens(repoRoot)
      const args = status.upstream ? ["push"] : ["push", "--set-upstream", "origin", status.branch]
      const env: Record<string, string> = {
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/false",
      }
      if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK

      const captured = await spawnCommandCapture({
        client,
        runId,
        cwd: repoRoot,
        cmd: "git",
        args,
        env,
        envAllowlist: ["GIT_TERMINAL_PROMPT", "GIT_ASKPASS", "SSH_AUTH_SOCK"],
        redactTokens,
        maxCaptureBytes: 256_000,
        allowNonZeroExit: true,
      })

      const ok = captured.exitCode === 0
      await client.mutation(api.runs.setStatus, {
        runId,
        status: ok ? "succeeded" : "failed",
        errorMessage: ok ? undefined : "git push failed",
      })

      return {
        ok,
        runId,
      }
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to push git changes.")
      console.error("executeGitPush failed", message)
      if (runId) {
        try {
          await client.mutation(api.runs.setStatus, { runId, status: "failed", errorMessage: "git push failed" })
        } catch {
          // ignore status failures
        }
      }
      throw new Error(message)
    } finally {
      statusCache.delete(repoRoot)
      statusInFlight.delete(repoRoot)
    }
  })()

  pushInFlight.set(repoRoot, task)
  task.finally(() => pushInFlight.delete(repoRoot)).catch(() => {})
  return await task
}
