import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawdletsEnvTokens } from "~/server/redaction"
import { spawnCommandCapture } from "~/server/run-manager"
import { capture } from "@clawdlets/core/lib/run"
import { getRepoRoot } from "~/sdk/repo-root"

type GitRepoStatus = {
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

function parseStatusLine(line: string): {
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  detached: boolean
} {
  const raw = line.replace(/^##\s+/, "").trim()
  if (!raw) {
    return { branch: null, upstream: null, ahead: null, behind: null, detached: false }
  }
  if (raw.startsWith("HEAD")) {
    return { branch: "HEAD", upstream: null, ahead: null, behind: null, detached: true }
  }

  const parts = raw.split("...")
  const branch = parts[0]?.trim().split(" ")[0] || null
  let upstream: string | null = null
  if (parts[1]) {
    upstream = parts[1].trim().split(" ")[0] || null
  }

  let ahead: number | null = null
  let behind: number | null = null
  const bracket = raw.match(/\[(.+)\]/)?.[1]
  if (bracket) {
    const tokens = bracket.split(",").map((t) => t.trim())
    for (const token of tokens) {
      const a = token.match(/^ahead\s+(\d+)$/)
      if (a) ahead = Number(a[1])
      const b = token.match(/^behind\s+(\d+)$/)
      if (b) behind = Number(b[1])
    }
  }

  return { branch, upstream, ahead, behind, detached: false }
}

async function readGitStatus(repoRoot: string): Promise<GitRepoStatus> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  const statusRaw = await capture("git", ["status", "-sb"], { cwd: repoRoot, env })
  const lines = statusRaw.split("\n").map((l) => l.trimEnd()).filter(Boolean)
  const firstLine = lines[0] || ""
  const parsed = parseStatusLine(firstLine)
  const dirty = lines.length > 1

  let localHead: string | null = null
  try {
    localHead = await capture("git", ["rev-parse", "HEAD"], { cwd: repoRoot, env })
  } catch {
    localHead = null
  }

  let originDefaultRef: string | null = null
  try {
    originDefaultRef = await capture("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: repoRoot, env })
  } catch {
    originDefaultRef = null
  }
  if (!originDefaultRef) {
    try {
      const remoteShow = await capture("git", ["remote", "show", "-n", "origin"], { cwd: repoRoot, env })
      const match = remoteShow.match(/HEAD branch:\s+([^\s]+)/)
      if (match?.[1]) originDefaultRef = `origin/${match[1]}`
    } catch {
      originDefaultRef = null
    }
  }

  let originHead: string | null = null
  if (originDefaultRef) {
    try {
      originHead = await capture("git", ["rev-parse", originDefaultRef], { cwd: repoRoot, env })
    } catch {
      originHead = null
    }
  }

  let originRemote = false
  try {
    const originUrl = await capture("git", ["remote", "get-url", "origin"], { cwd: repoRoot, env })
    originRemote = Boolean(originUrl.trim())
  } catch {
    originRemote = false
  }

  const hasUpstream = Boolean(parsed.upstream)
  const needsPush = !parsed.detached && (hasUpstream ? (parsed.ahead ?? 0) > 0 : true)
  const canPush = !parsed.detached && Boolean(parsed.branch) && (hasUpstream || originRemote)
  let pushBlockedReason: string | undefined
  if (parsed.detached) pushBlockedReason = "Detached HEAD; checkout a branch to push."
  else if (!parsed.branch) pushBlockedReason = "Unknown branch."
  else if (!hasUpstream && !originRemote) pushBlockedReason = "Missing origin remote."

  return {
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
}

export const gitRepoStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    return await readGitStatus(repoRoot)
  })

export const gitPushExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const status = await readGitStatus(repoRoot)
    if (!status.canPush) throw new Error(status.pushBlockedReason || "cannot push from this repo")
    if (status.detached || !status.branch) throw new Error("detached HEAD; checkout a branch")

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "custom",
      title: `Git push (${status.branch})`,
    })

    const redactTokens = await readClawdletsEnvTokens(repoRoot)
    const args = status.upstream ? ["push"] : ["push", "--set-upstream", "origin", status.branch]
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
    }

    const captured = await spawnCommandCapture({
      client,
      runId,
      cwd: repoRoot,
      cmd: "git",
      args,
      env,
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
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
      branch: status.branch,
      upstream: status.upstream,
    }
  })
