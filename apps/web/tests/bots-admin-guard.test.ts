import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadBots(role: "admin" | "viewer") {
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
  vi.doMock("@clawdlets/core/lib/clawdbot-schema-validate", () => ({
    validateClawdbotConfig: () => ({ ok: true }),
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
      loadClawdletsConfigRaw: () => ({
        configPath: "/tmp/fleet/clawdlets.json",
        config: { fleet: { bots: { bot1: { clawdbot: {} } } } },
      }),
      writeClawdletsConfig: async () => {},
    }
  })

  const mod = await import("~/sdk/bots")
  return { mod, mutation, runWithEvents }
}

describe("bots admin guard", () => {
  it("blocks viewer from mutating bot config", async () => {
    const { mod, mutation, runWithEvents } = await loadBots("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.setBotClawdbotConfig({
            data: {
              projectId: "p1" as any,
              botId: "bot1",
              clawdbot: {},
              schemaMode: "pinned",
              host: "",
            },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("allows admin to mutate bot config", async () => {
    const { mod } = await loadBots("admin")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.setBotClawdbotConfig({
          data: {
            projectId: "p1" as any,
            botId: "bot1",
            clawdbot: {},
            schemaMode: "pinned",
            host: "",
          },
        }),
    )
    expect(res.ok).toBe(true)
  })
})
