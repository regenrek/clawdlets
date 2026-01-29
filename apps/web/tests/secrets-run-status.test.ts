import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadSecretsVerify(options: { getRepoRootThrows: boolean }) {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, _payload?: { status?: string }) => null)

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query: vi.fn() }) as any,
  }))
  vi.doMock("~/sdk/run-guards", () => ({
    requireAdminAndBoundRun: async () => ({
      project: { localPath: "/tmp/repo" },
      role: "admin",
      repoRoot: "/tmp/repo",
      run: { kind: "secrets_verify", status: "running" },
    }),
  }))
  vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
    loadClawdletsConfig: () => {
      if (options.getRepoRootThrows) throw new Error("repo missing")
      return { config: { defaultHost: "alpha", hosts: { alpha: {} } } }
    },
  }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/clawdlets-cli", () => ({ resolveClawdletsCliEntry: () => "cli.js" }))
  vi.doMock("~/server/run-manager", () => ({
    runWithEvents: async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
      await fn(async () => {})
    },
    spawnCommandCapture: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
  }))

  const mod = await import("~/sdk/secrets-verify")
  return { mod, mutation }
}

async function loadSecretsSync(options: { spawnThrows: boolean }) {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, _payload?: { status?: string }) => null)

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query: vi.fn() }) as any,
  }))
  vi.doMock("~/sdk/run-guards", () => ({
    requireAdminAndBoundRun: async () => ({
      project: { localPath: "/tmp/repo" },
      role: "admin",
      repoRoot: "/tmp/repo",
      run: { kind: "secrets_sync", status: "running" },
    }),
  }))
  vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
    loadClawdletsConfig: () => ({ config: { defaultHost: "alpha", hosts: { alpha: {} } } }),
  }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/clawdlets-cli", () => ({ resolveClawdletsCliEntry: () => "cli.js" }))
  vi.doMock("~/server/run-manager", () => ({
    spawnCommand: async () => {
      if (options.spawnThrows) throw new Error("spawn failed")
    },
  }))

  const mod = await import("~/sdk/secrets-sync")
  return { mod, mutation }
}

describe("secrets run status", () => {
  it("marks run failed when verify pre-run setup throws", async () => {
    const { mod, mutation } = await loadSecretsVerify({ getRepoRootThrows: true })
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.secretsVerifyExecute({
          data: { projectId: "p1" as any, runId: "run1" as any, host: "alpha" },
        }),
    )
    expect(res.ok).toBe(false)
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })

  it("marks run failed when sync command throws", async () => {
    const { mod, mutation } = await loadSecretsSync({ spawnThrows: true })
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.secretsSyncExecute({
          data: { projectId: "p1" as any, runId: "run1" as any, host: "alpha" },
        }),
    )
    expect(res.ok).toBe(false)
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })
})
