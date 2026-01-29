import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadProjects(
  role: "admin" | "viewer",
  options: {
    runProjectId?: string
  } = {},
) {
  vi.resetModules()
  const initProject = vi.fn(async () => ({ plannedFiles: [], nextSteps: [] }))
  const runWithEvents = vi.fn(async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
    await fn(async () => {})
  })
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; status?: string; errorMessage?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async (_query: unknown, args?: { runId?: string }) => {
    if (args?.runId) return { run: { projectId: options.runProjectId ?? "p1" } }
    return { project: { localPath: "/tmp" }, role }
  })

  vi.doMock("@clawdlets/core/lib/project-init", () => ({
    initProject,
    planProjectInit: async () => ({ plannedFiles: [], nextSteps: [] }),
  }))
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/run-manager", () => ({ runWithEvents }))
  vi.doMock("~/server/template-spec", () => ({ resolveTemplateSpec: () => "github:owner/repo" }))

  const mod = await import("~/sdk/projects")
  return { mod, initProject, runWithEvents, mutation }
}

describe("project create execute guard", () => {
  it("blocks viewer and avoids side effects", async () => {
    const { mod, initProject, runWithEvents, mutation } = await loadProjects("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectCreateExecute({
            data: {
              projectId: "p1" as any,
              runId: "run1" as any,
              host: "clawdbot-fleet-host",
              templateSpec: { name: "default" } as any,
              gitInit: true,
            },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(initProject).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })

  it("allows admin and updates status", async () => {
    const { mod, initProject, runWithEvents, mutation } = await loadProjects("admin")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.projectCreateExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "clawdbot-fleet-host",
            templateSpec: { name: "default" } as any,
            gitInit: true,
          },
        }),
    )
    expect(res.ok).toBe(true)
    expect(initProject).toHaveBeenCalled()
    expect(runWithEvents).toHaveBeenCalled()
    const statusUpdates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status)
      .map((payload) => payload?.status)
    expect(statusUpdates).toEqual(expect.arrayContaining(["ready", "succeeded"]))
  })

  it("rejects runId mismatch and avoids side effects", async () => {
    const { mod, initProject, runWithEvents, mutation } = await loadProjects("admin", { runProjectId: "p2" })
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectCreateExecute({
            data: {
              projectId: "p1" as any,
              runId: "run1" as any,
              host: "clawdbot-fleet-host",
              templateSpec: { name: "default" } as any,
              gitInit: true,
            },
          }),
      ),
    ).rejects.toThrow(/runid does not match project/i)
    expect(initProject).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })
})
