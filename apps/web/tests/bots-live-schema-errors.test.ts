import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

import { LIVE_SCHEMA_ERROR_FALLBACK } from "~/sdk/bots"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadBots(options: {
  fetchLive?: () => Promise<{ ok: boolean; message?: string; schema?: { schema: Record<string, unknown> } }>
  validate?: () => { ok: boolean; issues?: Array<{ path: Array<string | number>; message: string }> }
}) {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("@clawdlets/core/lib/clawdbot-schema-validate", () => ({
    validateClawdbotConfig: options.validate ?? (() => ({ ok: true })),
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
  vi.doMock("~/server/clawdbot-schema.server", () => ({
    fetchClawdbotSchemaLive:
      options.fetchLive ?? (async () => ({ ok: true, schema: { schema: { type: "object" } } })),
  }))

  const mod = await import("~/sdk/bots")
  return { mod, mutation }
}

describe("setBotClawdbotConfig schema error mapping", () => {
  const context = {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }

  it("returns schema error when live schema returns ok:false", async () => {
    const { mod, mutation } = await loadBots({
      fetchLive: async () => ({ ok: false, message: "too many requests" }),
    })
    const res = await runWithStartContext(context, async () =>
      mod.setBotClawdbotConfig({
        data: { projectId: "p1" as any, botId: "bot1", host: "h1", schemaMode: "live", clawdbot: {} },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues).toEqual([{ code: "schema", path: [], message: "too many requests" }])
    }
    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind)
    expect(runCreates).toHaveLength(0)
  })

  it("returns sanitized schema error when live schema throws", async () => {
    const { mod } = await loadBots({
      fetchLive: async () => {
        throw new Error("ssh: connect to host 10.0.0.1 port 22: Connection timed out; cmd: bash -lc 'secret'")
      },
    })
    const res = await runWithStartContext(context, async () =>
      mod.setBotClawdbotConfig({
        data: { projectId: "p1" as any, botId: "bot1", host: "h1", schemaMode: "live", clawdbot: {} },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues).toEqual([{ code: "schema", path: [], message: LIVE_SCHEMA_ERROR_FALLBACK }])
    }
  })

  it("maps schema validation issues when pinned schema rejects", async () => {
    const { mod, mutation } = await loadBots({
      validate: () => ({ ok: false, issues: [{ path: ["name"], message: "name: required" }] }),
    })
    const res = await runWithStartContext(context, async () =>
      mod.setBotClawdbotConfig({
        data: { projectId: "p1" as any, botId: "bot1", host: "", schemaMode: "pinned", clawdbot: {} },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues).toEqual([{ code: "schema", path: ["name"], message: "name: required" }])
    }
    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind)
    expect(runCreates).toHaveLength(0)
  })
})
