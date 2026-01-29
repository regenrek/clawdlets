import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadConfig() {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
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
      loadClawdletsConfig: () => ({
        configPath: "/tmp/fleet/clawdlets.json",
        config: { fleet: { bots: { bot1: { clawdbot: { ok: true } } } } },
      }),
      loadClawdletsConfigRaw: () => ({
        configPath: "/tmp/fleet/clawdlets.json",
        config: { fleet: { bots: { bot1: { clawdbot: { ok: true } } } } },
      }),
      writeClawdletsConfig: async () => {},
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation, runWithEvents }
}

describe("config bot clawdbot policy", () => {
  it("rejects bot clawdbot path updates via configDotSet", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "fleet.bots.bot1.clawdbot.token",
            value: "nope",
            valueJson: undefined,
            del: false,
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("rejects clawdbot changes via writeClawdletsConfigFile", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawdletsConfigFile({
          data: {
            projectId: "p1" as any,
            next: { fleet: { bots: { bot1: { clawdbot: { ok: false } } } } },
            title: "Update config",
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })
})
