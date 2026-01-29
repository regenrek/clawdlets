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

describe("secrets write admin guard", () => {
  it("blocks viewer before any filesystem writes", async () => {
    vi.resetModules()
    const sopsEncryptYamlToFile = vi.fn(async () => {})
    const writeFileAtomic = vi.fn(async () => {})

    vi.doMock("~/sdk/repo-root", () => ({
      getAdminProjectContext: async () => {
        throw new Error("admin required")
      },
    }))
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation: vi.fn(), query: vi.fn() }) as any,
    }))

    vi.doMock("@clawdlets/core/lib/sops", () => ({ sopsEncryptYamlToFile }))
    vi.doMock("@clawdlets/core/lib/fs-safe", () => ({ writeFileAtomic }))

    const { writeHostSecrets } = await import("~/sdk/secrets-write")
    await expect(
      runWithStartContext(startContext, async () =>
        await writeHostSecrets({
          data: { projectId: "p1" as any, host: "alpha", secrets: { openai_api_key: "x" } },
        }),
      ),
    ).rejects.toThrow(/admin required/i)

    expect(sopsEncryptYamlToFile).not.toHaveBeenCalled()
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })
})

