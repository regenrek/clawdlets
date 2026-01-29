import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadConfig(role: "admin" | "viewer") {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role }))
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
      loadClawdletsConfig: () => ({ configPath: "/tmp/fleet/clawdlets.json", config: {} }),
      loadClawdletsConfigRaw: () => ({ configPath: "/tmp/fleet/clawdlets.json", config: {} }),
      writeClawdletsConfig: async () => {},
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation, runWithEvents }
}

describe("config admin guard", () => {
  it("blocks viewer from writing config", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.writeClawdletsConfigFile({
            data: { projectId: "p1" as any, next: {}, title: "write config" },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("blocks viewer from config dot-get", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotGet({
            data: { projectId: "p1" as any, path: "fleet.codex.enable" },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("allows admin to write config", async () => {
    const { mod } = await loadConfig("admin")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawdletsConfigFile({
          data: { projectId: "p1" as any, next: {}, title: "write config" },
        }),
    )
    expect(res.ok).toBe(true)
  })
})
