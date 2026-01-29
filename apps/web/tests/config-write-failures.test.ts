import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadConfigForWrite() {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; status?: string; errorMessage?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
  const runWithEvents = vi.fn(async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
    await fn(async () => {})
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/run-manager", () => ({
    runWithEvents,
  }))
  vi.doMock("@clawdlets/core/lib/clawdlets-config", async () => {
    const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdlets-config")>(
      "@clawdlets/core/lib/clawdlets-config",
    )
    return {
      ...actual,
      ClawdletsConfigSchema: {
        safeParse: (value: unknown) => ({ success: true, data: value }),
      },
      loadClawdletsConfigRaw: () => ({ configPath: "/tmp/fleet/clawdlets.json", config: {} }),
      writeClawdletsConfig: async () => {
        throw new Error("permission denied: /etc/hosts")
      },
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation, runWithEvents }
}

describe("config write failures", () => {
  it("writeClawdletsConfigFile returns ok:false and marks run failed", async () => {
    const { mod, mutation, runWithEvents } = await loadConfigForWrite()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawdletsConfigFile({
          data: { projectId: "p1" as any, next: {}, title: "write config" },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.message).toBe("run failed")
    }
    expect(runWithEvents).toHaveBeenCalled()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.errorMessage).toBe("run failed")
  })

  it("configDotSet returns ok:false and marks run failed", async () => {
    const { mod, mutation, runWithEvents } = await loadConfigForWrite()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "fleet.codex.enable",
            value: "true",
            valueJson: undefined,
            del: false,
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.message).toBe("run failed")
    }
    expect(runWithEvents).toHaveBeenCalled()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.errorMessage).toBe("run failed")
  })
})
