import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadWorkspaceDocs(options: { pathExists: boolean; writeThrows: boolean; trashThrows: boolean; ensureThrows: boolean }) {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; status?: string; errorMessage?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query: vi.fn(async () => ({})) }) as any,
  }))
  vi.doMock("~/sdk/repo-root", () => ({ getRepoRoot: async () => "/tmp/repo" }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/run-manager", () => ({
    runWithEvents: async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
      await fn(async () => {})
    },
  }))
  vi.doMock("@clawdlets/core/repo-layout", () => ({
    getRepoLayout: () => ({
      repoRoot: "/tmp/repo",
      fleetWorkspacesCommonDir: "/tmp/repo/fleet/workspaces/common",
      fleetWorkspacesBotDir: "/tmp/repo/fleet/workspaces/bots",
    }),
    getBotWorkspaceDir: (_layout: unknown, botId: string) => `/tmp/repo/fleet/workspaces/bots/${botId}`,
  }))
  vi.doMock("@clawdlets/core/lib/fleet-workspaces", () => ({
    isFleetWorkspaceEditableDoc: () => true,
    FLEET_WORKSPACE_EDITABLE_DOCS: [],
  }))
  vi.doMock("@clawdlets/core/lib/fs-safe", () => ({
    ensureDir: async () => {
      if (options.ensureThrows) throw new Error("mkdir failed")
    },
    pathExists: async () => options.pathExists,
    writeFileAtomic: async () => {
      if (options.writeThrows) throw new Error("write failed")
    },
  }))
  vi.doMock("trash", () => ({
    default: async () => {
      if (options.trashThrows) throw new Error("trash failed")
    },
  }))

  const mod = await import("~/sdk/workspace-docs")
  return { mod, mutation }
}

describe("workspace docs run status", () => {
  it("marks run failed when writeFileAtomic throws", async () => {
    const { mod, mutation } = await loadWorkspaceDocs({
      pathExists: false,
      writeThrows: true,
      trashThrows: false,
      ensureThrows: false,
    })
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.writeWorkspaceDoc({
            data: {
              projectId: "p1" as any,
              scope: "common",
              botId: "",
              name: "README.md",
              content: "hello",
              expectedSha256: "",
            },
          }),
      ),
    ).rejects.toThrow()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })

  it("marks run failed when trash throws", async () => {
    const { mod, mutation } = await loadWorkspaceDocs({
      pathExists: true,
      writeThrows: false,
      trashThrows: true,
      ensureThrows: false,
    })
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.resetWorkspaceDocOverride({
            data: {
              projectId: "p1" as any,
              botId: "bot1",
              name: "README.md",
              expectedSha256: "",
            },
          }),
      ),
    ).rejects.toThrow()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })

  it("marks run failed when ensureDir throws", async () => {
    const { mod, mutation } = await loadWorkspaceDocs({
      pathExists: false,
      writeThrows: false,
      trashThrows: false,
      ensureThrows: true,
    })
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.writeWorkspaceDoc({
            data: {
              projectId: "p1" as any,
              scope: "common",
              botId: "",
              name: "README.md",
              content: "hello",
              expectedSha256: "",
            },
          }),
      ),
    ).rejects.toThrow()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })
})
