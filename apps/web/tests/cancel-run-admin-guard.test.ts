import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadCancelRun(options: { role: "admin" | "viewer"; status: string }) {
  vi.resetModules()
  const cancelActiveRun = vi.fn(() => true)
  const runWithEvents = vi.fn(async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
    await fn(async () => {})
  })
  const mutation = vi.fn(async (_mutation: unknown, _payload?: { status?: string }) => null)
  const query = vi.fn(async () => ({
    run: { projectId: "p1", status: options.status },
    role: options.role,
    project: { localPath: "/tmp" },
  }))

  vi.doMock("~/server/run-manager", () => ({ cancelActiveRun, runWithEvents }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/paths", () => ({ assertRepoRootPath: () => "/tmp/repo" }))
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))

  const mod = await import("~/sdk/runs")
  return { mod, cancelActiveRun, runWithEvents, mutation }
}

describe("cancelRun guard", () => {
  it("blocks viewer and avoids side effects", async () => {
    const { mod, cancelActiveRun, runWithEvents, mutation } = await loadCancelRun({
      role: "viewer",
      status: "running",
    })
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () => await mod.cancelRun({ data: { runId: "run1" as any } }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(cancelActiveRun).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })

  it("does not cancel finished runs", async () => {
    const { mod, cancelActiveRun, runWithEvents, mutation } = await loadCancelRun({
      role: "admin",
      status: "succeeded",
    })
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () => await mod.cancelRun({ data: { runId: "run1" as any } }),
    )
    expect(res.canceled).toBe(false)
    expect(cancelActiveRun).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status)
    expect(statusCalls).toHaveLength(0)
  })
})
