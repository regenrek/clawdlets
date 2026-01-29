import { describe, expect, it, vi } from "vitest"

describe("clawdbot schema status cache", () => {
  it("reuses cached result within TTL", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    let callCount = 0
    const fetchSpy = vi.fn(async () => {
      callCount += 1
      return {
        ok: true as const,
        info: { rev: `rev-main-${callCount}` },
        sourceUrl: "https://example.com",
      }
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getProjectContext: async (_client: unknown, projectId: string) => ({
        project: { localPath: `/tmp/${projectId}` },
        role: "admin",
        repoRoot: `/tmp/${projectId}`,
      }),
      getRepoRoot: async (_client: unknown, projectId: string) => `/tmp/${projectId}`,
    }))
    vi.doMock("@clawdlets/core/lib/nix-clawdbot", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/nix-clawdbot")>(
        "@clawdlets/core/lib/nix-clawdbot",
      )
      return {
        ...actual,
        fetchNixClawdbotSourceInfo: fetchSpy,
        getNixClawdbotRevFromFlakeLock: () => "pin-a",
      }
    })
    const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    const callsAfterFirst = fetchSpy.mock.calls.length
    const second = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    expect(first).toEqual(second)
    expect(callsAfterFirst).toBeGreaterThanOrEqual(2)
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst)
    vi.useRealTimers()
  })

  it("isolates cache per project", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    let callCount = 0
    const fetchSpy = vi.fn(async () => {
      callCount += 1
      return {
        ok: true as const,
        info: { rev: `rev-${callCount}` },
        sourceUrl: "https://example.com",
      }
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getProjectContext: async (_client: unknown, projectId: string) => ({
        project: { localPath: `/tmp/${projectId}` },
        role: "admin",
        repoRoot: `/tmp/${projectId}`,
      }),
      getRepoRoot: async (_client: unknown, projectId: string) => `/tmp/${projectId}`,
    }))
    vi.doMock("@clawdlets/core/lib/nix-clawdbot", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/nix-clawdbot")>(
        "@clawdlets/core/lib/nix-clawdbot",
      )
      return {
        ...actual,
        fetchNixClawdbotSourceInfo: fetchSpy,
        getNixClawdbotRevFromFlakeLock: (repoRoot: string) => {
          return repoRoot.includes("p1") ? "pin-a" : "pin-b"
        },
      }
    })
    const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    const second = await fetchClawdbotSchemaStatus({ projectId: "p2" as any })
    expect(first.ok && second.ok ? first.pinned?.nixClawdbotRev !== second.pinned?.nixClawdbotRev : false).toBe(true)
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    vi.useRealTimers()
  })

  it("caches failures briefly", async () => {
    vi.resetModules()
    const compareSpy = vi.fn(async () => {
      throw new Error("boom")
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getProjectContext: async (_client: unknown, projectId: string) => ({
        project: { localPath: `/tmp/${projectId}` },
        role: "admin",
        repoRoot: `/tmp/${projectId}`,
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-schema-compare", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdbot-schema-compare")>(
        "@clawdlets/core/lib/clawdbot-schema-compare",
      )
      return {
        ...actual,
        compareClawdbotSchemaToNixClawdbot: compareSpy,
      }
    })

    const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    const second = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    expect(first.ok).toBe(false)
    expect(second).toEqual(first)
    expect(compareSpy).toHaveBeenCalledTimes(1)
  })

  it("dedupes source fetches across concurrent status calls", async () => {
    vi.resetModules()
    vi.doMock("@clawdlets/core/lib/clawdbot-schema-compare", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdbot-schema-compare")>(
        "@clawdlets/core/lib/clawdbot-schema-compare",
      )
      return actual
    })
    const pinnedRef = "pin-a"
    let resolvePinned: (value: any) => void
    let resolveUpstream: (value: any) => void
    const fetchSpy = vi.fn(async ({ ref }: { ref: string }) => {
      if (ref === pinnedRef) {
        return await new Promise((resolve) => {
          resolvePinned = resolve
        })
      }
      if (ref === "main") {
        return await new Promise((resolve) => {
          resolveUpstream = resolve
        })
      }
      throw new Error("unexpected ref")
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getProjectContext: async (_client: unknown, projectId: string) => ({
        project: { localPath: `/tmp/${projectId}` },
        role: "admin",
        repoRoot: `/tmp/${projectId}`,
      }),
    }))
    vi.doMock("@clawdlets/core/lib/nix-clawdbot", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/nix-clawdbot")>(
        "@clawdlets/core/lib/nix-clawdbot",
      )
      return {
        ...actual,
        fetchNixClawdbotSourceInfo: fetchSpy,
        getNixClawdbotRevFromFlakeLock: () => pinnedRef,
      }
    })
    const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
    const firstPromise = fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    const secondPromise = fetchClawdbotSchemaStatus({ projectId: "p2" as any })
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    resolvePinned!({ ok: true as const, info: { rev: "rev-pin" }, sourceUrl: "https://example.com" })
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    resolveUpstream!({ ok: true as const, info: { rev: "rev-main" }, sourceUrl: "https://example.com" })
    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
  })
})
