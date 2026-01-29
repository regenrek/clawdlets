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

async function loadWithCapture(config: CaptureConfig) {
  vi.resetModules()
  const capture = createCapture(config)
  vi.doMock("@clawdlets/core/lib/run", () => ({ capture }))
  const mod = await import("~/server/git.server")
  return { ...mod, capture }
}

describe("git status parsing", () => {
  it("parses upstream ahead/behind and detached states", async () => {
    const { __test_parsePorcelainStatus } = await loadWithCapture({ statusOutput: "" })
    expect(
      __test_parsePorcelainStatus(
        ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -0"].join("\n"),
      ),
    ).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      detached: false,
      localHead: "local-head",
      dirty: false,
    })
    expect(
      __test_parsePorcelainStatus(
        ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -3"].join("\n"),
      ),
    ).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 3,
      detached: false,
      localHead: "local-head",
      dirty: false,
    })
    expect(__test_parsePorcelainStatus(["# branch.oid local-head", "# branch.head main"].join("\n"))).toEqual({
      branch: "main",
      upstream: null,
      ahead: null,
      behind: null,
      detached: false,
      localHead: "local-head",
      dirty: false,
    })
    expect(__test_parsePorcelainStatus(["# branch.oid local-head", "# branch.head (detached)"].join("\n"))).toEqual({
      branch: "HEAD",
      upstream: null,
      ahead: null,
      behind: null,
      detached: true,
      localHead: "local-head",
      dirty: false,
    })
  })

  it("stops parsing after first dirty entry", async () => {
    const { __test_parsePorcelainStatus } = await loadWithCapture({ statusOutput: "" })
    const raw = [
      "# branch.oid local-head",
      "# branch.head main",
      "1 .M N... 100644 100644 100644 abc def file.txt",
      "# branch.ab +3 -1",
    ].join("\n")
    expect(__test_parsePorcelainStatus(raw)).toEqual({
      branch: "main",
      upstream: null,
      ahead: null,
      behind: null,
      detached: false,
      localHead: "local-head",
      dirty: true,
    })
  })

  it("avoids splitting large status output", async () => {
    const { __test_parsePorcelainStatus } = await loadWithCapture({ statusOutput: "" })
    const splitSpy = vi.spyOn(String.prototype, "split")
    try {
      __test_parsePorcelainStatus(["# branch.oid local-head", "# branch.head main"].join("\n"))
      expect(splitSpy.mock.calls.length).toBe(0)
    } finally {
      splitSpy.mockRestore()
    }
  })

  it("reuses cached status briefly", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"))

      const { readGitStatus, __test_gitStatusCache, capture } = await loadWithCapture({
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
          "\n",
        ),
        originDefaultRef: "origin/main",
      })
      __test_gitStatusCache.clear()

      await readGitStatus("/tmp/repo")
      const firstCalls = capture.mock.calls.length

      await readGitStatus("/tmp/repo")
      expect(capture.mock.calls.length).toBe(firstCalls)

      vi.setSystemTime(new Date(Date.now() + __test_gitStatusCache.ttlMs + 1))
      await readGitStatus("/tmp/repo")
      expect(capture.mock.calls.length).toBeGreaterThan(firstCalls)
    } finally {
      vi.useRealTimers()
    }
  })

  it("caches timeout failures briefly", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"))
      vi.resetModules()
      const capture = vi.fn(
        async (_cmd: string, args: string[], opts?: { timeoutMs?: number; maxOutputBytes?: number }) => {
          if (args[0] === "status") {
            if (opts?.timeoutMs) throw new Error(`git timed out after ${opts.timeoutMs}ms`)
            throw new Error("git timed out")
          }
          return ""
        },
      )
      vi.doMock("@clawdlets/core/lib/run", () => ({ capture }))
      const mod = await import("~/server/git.server")
      mod.__test_gitStatusCache.clear()

      const firstAttempt = mod.readGitStatus("/tmp/repo")
      firstAttempt.catch(() => {})
      await expect(firstAttempt).rejects.toThrow("timed out")
      const firstCall = capture.mock.calls[0]
      expect(firstCall?.[2]?.timeoutMs).toBeGreaterThan(0)
      expect(firstCall?.[2]?.maxOutputBytes).toBeGreaterThan(0)

      const firstCalls = capture.mock.calls.length
      const cachedAttempt = mod.readGitStatus("/tmp/repo")
      cachedAttempt.catch(() => {})
      await expect(cachedAttempt).rejects.toThrow("timed out")
      expect(capture.mock.calls.length).toBe(firstCalls)

      vi.setSystemTime(new Date(Date.now() + mod.__test_gitStatusCache.failureTtlMs + 1))
      const retryAttempt = mod.readGitStatus("/tmp/repo")
      retryAttempt.catch(() => {})
      await expect(retryAttempt).rejects.toThrow("timed out")
      expect(capture.mock.calls.length).toBe(firstCalls + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("computes canPush/needsPush across upstream and origin cases", async () => {
    const cases = [
      {
        name: "ahead with upstream",
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -0"].join(
          "\n",
        ),
        originUrl: "git@github.com:org/repo.git",
        originDefaultRef: "origin/main",
        expected: { needsPush: true, canPush: true, pushBlockedReason: undefined },
      },
      {
        name: "upstream no ahead",
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -0"].join(
          "\n",
        ),
        originUrl: "git@github.com:org/repo.git",
        originDefaultRef: "origin/main",
        expected: { needsPush: false, canPush: true, pushBlockedReason: undefined },
      },
      {
        name: "no upstream but origin present",
        statusOutput: ["# branch.oid local-head", "# branch.head main"].join("\n"),
        originUrl: "git@github.com:org/repo.git",
        originDefaultRef: "origin/main",
        expected: { needsPush: true, canPush: true, pushBlockedReason: undefined },
      },
      {
        name: "no upstream and missing origin",
        statusOutput: ["# branch.oid local-head", "# branch.head main"].join("\n"),
        originUrl: null,
        originDefaultRef: null,
        expected: { needsPush: true, canPush: false, pushBlockedReason: "Missing origin remote." },
      },
      {
        name: "detached head",
        statusOutput: ["# branch.oid local-head", "# branch.head (detached)"].join("\n"),
        originUrl: "git@github.com:org/repo.git",
        originDefaultRef: "origin/main",
        expected: { needsPush: false, canPush: false, pushBlockedReason: "Detached HEAD; checkout a branch to push." },
      },
    ]

    for (const entry of cases) {
      const { readGitStatus } = await loadWithCapture({
        statusOutput: entry.statusOutput,
        originUrl: entry.originUrl,
        originDefaultRef: entry.originDefaultRef,
      })
      const status = await readGitStatus("/tmp/repo")
      expect({ needsPush: status.needsPush, canPush: status.canPush, pushBlockedReason: status.pushBlockedReason }).toEqual(
        entry.expected,
      )
    }
  })

  it("dedupes in-flight status reads", async () => {
    vi.resetModules()
    let resolveStatus: (value: string) => void
    const statusPromise = new Promise<string>((resolve) => {
      resolveStatus = resolve
    })
    const capture = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "status") return await statusPromise
      if (args[0] === "for-each-ref") return "origin/main origin-head"
      return ""
    })
    vi.doMock("@clawdlets/core/lib/run", () => ({ capture }))
    const mod = await import("~/server/git.server")
    mod.__test_gitStatusCache.clear()
    const first = mod.readGitStatus("/tmp/repo")
    const second = mod.readGitStatus("/tmp/repo")
    expect(capture).toHaveBeenCalledTimes(1)
    resolveStatus!(
      ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join("\n"),
    )
    await Promise.all([first, second])
    const statusCalls = capture.mock.calls.filter((call) => call[1][0] === "status")
    expect(statusCalls).toHaveLength(1)
  })
})
