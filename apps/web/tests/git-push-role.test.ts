import { describe, expect, it, vi } from "vitest"

type CaptureConfig = {
  statusOutput: string
  originUrl?: string | null
  originDefaultRef?: string | null
  originHead?: string | null
}

function createCapture(config: CaptureConfig) {
  return vi.fn(async (_cmd: string, args: string[]) => {
    if (args[0] === "status") return config.statusOutput
    if (args[0] === "for-each-ref") {
      if (config.originDefaultRef === null) return ""
      const ref = config.originDefaultRef ?? "origin/main"
      const head = config.originHead ?? "origin-head"
      return `${ref} ${head}`
    }
    if (args[0] === "remote" && args[1] === "show") return "HEAD branch: main"
    if (args[0] === "rev-parse") return config.originHead ?? "origin-head"
    if (args[0] === "config" && args[1] === "--get") {
      if (config.originUrl === null) throw new Error("no origin")
      return config.originUrl ?? "git@github.com:org/repo.git"
    }
    return ""
  })
}

async function loadGitServer(role: "admin" | "viewer") {
  vi.resetModules()
  const capture = createCapture({
    statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
      "\n",
    ),
    originDefaultRef: "origin/main",
  })
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role }))

  vi.doMock("@clawdlets/core/lib/run", () => ({ capture }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  const spawnCommandCapture = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }))
  vi.doMock("~/server/run-manager", () => ({
    spawnCommandCapture,
  }))
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))

  const mod = await import("~/server/git.server")
  return { mod, mutation, spawnCommandCapture }
}

describe("git push role guard", () => {
  it("blocks viewer from pushing", async () => {
    const { mod, mutation, spawnCommandCapture } = await loadGitServer("viewer")
    await expect(mod.executeGitPush({ projectId: "p1" as any })).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(spawnCommandCapture).not.toHaveBeenCalled()
  })

  it("allows admin to push", async () => {
    const { mod } = await loadGitServer("admin")
    const res = await mod.executeGitPush({ projectId: "p1" as any })
    expect(res.ok).toBe(true)
    expect(res.runId).toBe("run1")
  })
})
