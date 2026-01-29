import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

const startContext = {
  request: new Request("http://localhost"),
  contextAfterGlobalMiddlewares: {},
  executedRequestMiddlewares: new Set(),
}

describe("execute admin guard", () => {
  it("blocks viewer from server-ops execute endpoints", async () => {
    vi.resetModules()
    const spawnCommand = vi.fn(async () => {})
    const spawnCommandCapture = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))

    vi.doMock("~/sdk/run-guards", () => ({
      requireAdminAndBoundRun: async () => {
        throw new Error("admin required")
      },
    }))
    vi.doMock("~/server/run-manager", () => ({ spawnCommand, spawnCommandCapture }))
    vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
    vi.doMock("~/server/clawdlets-cli", () => ({ resolveClawdletsCliEntry: () => "cli.js" }))
    vi.doMock("~/server/convex", () => ({ createConvexClient: () => ({ mutation: vi.fn(), query: vi.fn() }) as any }))

    const mod = await import("~/sdk/server-ops")

    await expect(
      runWithStartContext(startContext, async () =>
        await mod.serverDeployExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "alpha",
            manifestPath: "",
            rev: "",
            targetHost: "",
            confirm: "deploy alpha",
          },
        }),
      ),
    ).rejects.toThrow(/admin required/i)

    await expect(
      runWithStartContext(startContext, async () =>
        await mod.serverAuditExecute({
          data: { projectId: "p1" as any, runId: "run1" as any, host: "alpha", targetHost: "" },
        }),
      ),
    ).rejects.toThrow(/admin required/i)

    expect(spawnCommand).not.toHaveBeenCalled()
    expect(spawnCommandCapture).not.toHaveBeenCalled()
  })

  it("blocks viewer from secrets/server channels/bootstrap execute endpoints", async () => {
    vi.resetModules()
    const spawnCommand = vi.fn(async () => {})
    const spawnCommandCapture = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))

    vi.doMock("~/sdk/run-guards", () => ({
      requireAdminAndBoundRun: async () => {
        throw new Error("admin required")
      },
    }))
    vi.doMock("~/server/run-manager", () => ({ spawnCommand, spawnCommandCapture, runWithEvents: vi.fn(async () => {}) }))
    vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => [] }))
    vi.doMock("~/server/clawdlets-cli", () => ({ resolveClawdletsCliEntry: () => "cli.js" }))
    vi.doMock("~/server/convex", () => ({ createConvexClient: () => ({ mutation: vi.fn(), query: vi.fn() }) as any }))

    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({ config: { defaultHost: "alpha", hosts: { alpha: {} }, fleet: { bots: { bot1: {} } } } }),
    }))

    const [{ secretsInitExecute }, { serverChannelsExecute }, { bootstrapExecute }] = await Promise.all([
      import("~/sdk/secrets-init"),
      import("~/sdk/server-channels"),
      import("~/sdk/operations"),
    ])

    await expect(
      runWithStartContext(startContext, async () =>
        await secretsInitExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "alpha",
            allowPlaceholders: true,
            adminPassword: "",
            adminPasswordHash: "",
            tailscaleAuthKey: "",
            secrets: {},
          },
        }),
      ),
    ).rejects.toThrow(/admin required/i)

    await expect(
      runWithStartContext(startContext, async () =>
        await serverChannelsExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "alpha",
            botId: "bot1",
            op: "status",
            channel: "",
            account: "",
            target: "",
            timeoutMs: 10_000,
            json: false,
            probe: false,
            verbose: false,
          },
        }),
      ),
    ).rejects.toThrow(/admin required/i)

    await expect(
      runWithStartContext(startContext, async () =>
        await bootstrapExecute({
          data: {
            projectId: "p1" as any,
            runId: "run1" as any,
            host: "alpha",
            mode: "nixos-anywhere",
            force: false,
            dryRun: true,
            rev: "",
          },
        }),
      ),
    ).rejects.toThrow(/admin required/i)

    expect(spawnCommand).not.toHaveBeenCalled()
    expect(spawnCommandCapture).not.toHaveBeenCalled()
  })
})

