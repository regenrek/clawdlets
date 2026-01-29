import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadSecretsInit(options: { mkpasswdThrows: boolean; writeThrows: boolean }) {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { status?: string }) => {
    return null
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query: vi.fn() }) as any,
  }))
  vi.doMock("~/sdk/run-guards", () => ({
    requireAdminAndBoundRun: async () => ({
      project: { localPath: "/tmp/repo" },
      role: "admin",
      repoRoot: "/tmp/repo",
      run: { kind: "secrets_init", status: "running" },
    }),
  }))
  vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
    loadClawdletsConfig: () => ({ config: { defaultHost: "alpha", hosts: { alpha: {} } } }),
  }))
  vi.doMock("@clawdlets/core/lib/secrets-allowlist", () => ({
    buildManagedHostSecretNameAllowlist: () => new Set<string>(),
    assertSecretsAreManaged: () => {},
  }))
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
  vi.doMock("~/server/clawdlets-cli", () => ({ resolveClawdletsCliEntry: () => "cli.js" }))
  vi.doMock("~/server/run-manager", () => ({
    runWithEvents: async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
      await fn(async () => {})
    },
    spawnCommand: async () => {},
  }))
  vi.doMock("@clawdlets/core/lib/mkpasswd", () => ({
    mkpasswdYescryptHash: async () => {
      if (options.mkpasswdThrows) throw new Error("hash failed")
      return "hash"
    },
  }))
  vi.doMock("@clawdlets/core/lib/fs-safe", () => ({
    writeFileAtomic: async () => {
      if (options.writeThrows) throw new Error("write failed")
    },
  }))

  const mod = await import("~/sdk/secrets-init")
  return { mod, mutation }
}

describe("secrets init run status", () => {
  it("marks run failed when mkpasswdYescryptHash throws", async () => {
    const { mod, mutation } = await loadSecretsInit({ mkpasswdThrows: true, writeThrows: false })
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.secretsInitExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "alpha",
            adminPassword: "pw",
            adminPasswordHash: "",
            tailscaleAuthKey: "",
            allowPlaceholders: true,
            secrets: {},
          },
        }),
    )
    expect(res.ok).toBe(false)
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })

  it("marks run failed when writeFileAtomic throws", async () => {
    const { mod, mutation } = await loadSecretsInit({ mkpasswdThrows: false, writeThrows: true })
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.secretsInitExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "alpha",
            adminPassword: "pw",
            adminPasswordHash: "",
            tailscaleAuthKey: "",
            allowPlaceholders: true,
            secrets: {},
          },
        }),
    )
    expect(res.ok).toBe(false)
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
  })
})
