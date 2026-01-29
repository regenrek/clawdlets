import { describe, expect, it, vi, afterEach } from "vitest"

type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> }

const ORIGIN = "https://app.example.com"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubWindow() {
  vi.stubGlobal("window", {
    location: { origin: ORIGIN },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
}

describe("monaco schema fetch safety", () => {
  it("blocks cross-origin schema fetch", async () => {
    stubWindow()
    vi.stubGlobal("fetch", vi.fn())
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await expect(__test_schemaRequestService("https://evil.example.com/schema.json")).rejects.toThrow(
      "schema fetch blocked by origin policy",
    )
  })

  it("blocks origin prefix bypasses", async () => {
    stubWindow()
    vi.stubGlobal("fetch", vi.fn())
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await expect(__test_schemaRequestService("https://app.example.com.evil.com/schema.json")).rejects.toThrow(
      "schema fetch blocked by origin policy",
    )
    await expect(__test_schemaRequestService("https://app.example.com@evil.com/schema.json")).rejects.toThrow(
      "schema fetch blocked by origin policy",
    )
  })

  it("enforces timeout + size limit", async () => {
    stubWindow()
    const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<FetchResponse>((resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        }
        resolve({
          ok: true,
          status: 200,
          text: async () => "x".repeat(600 * 1024),
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await expect(__test_schemaRequestService("https://app.example.com/schema.json")).rejects.toThrow()
  })

  it("passes redirect error mode to fetch", async () => {
    stubWindow()
    const fetchMock = vi.fn(async (_url: string, opts?: { redirect?: string }) => ({
      ok: true,
      status: 200,
      text: async () => "{}",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await __test_schemaRequestService("https://app.example.com/schema.json")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error")
  })

  it("rejects non-2xx schema responses", async () => {
    stubWindow()
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 418,
      text: async () => "nope",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await expect(__test_schemaRequestService("https://app.example.com/schema.json")).rejects.toThrow(
      "schema fetch failed: 418",
    )
  })

  it("rejects unsupported and invalid schema URIs", async () => {
    stubWindow()
    vi.stubGlobal("fetch", vi.fn())
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await expect(__test_schemaRequestService("inmemory://schema.json")).rejects.toThrow(/unsupported schema uri/i)
    await expect(__test_schemaRequestService("/schema.json")).rejects.toThrow(/unsupported schema uri/i)
    await expect(__test_schemaRequestService("https://%")).rejects.toThrow(/invalid schema uri/i)
  })

  it("aborts schema fetch after timeout", async () => {
    vi.useFakeTimers()
    stubWindow()
    const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<FetchResponse>((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    const promise = __test_schemaRequestService("https://app.example.com/schema.json")
    const assertion = expect(promise).rejects.toThrow(/abort/i)
    await vi.advanceTimersByTimeAsync(3_001)
    await assertion
  })

  it("serves cached schema without refetch", async () => {
    stubWindow()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "{}",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await __test_schemaRequestService("https://app.example.com/schema.json")
    await __test_schemaRequestService("https://app.example.com/schema.json")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("caches schema fetch failures briefly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    stubWindow()
    let attempt = 0
    const fetchMock = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) return { ok: false, status: 500, text: async () => "nope" }
      return { ok: true, status: 200, text: async () => "{}" }
    })
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache, __test_getSchemaFailureTtlMs } = await import(
      "~/components/editor/monaco-json-editor"
    )
    __test_resetSchemaCache()

    await expect(__test_schemaRequestService("https://app.example.com/schema.json")).rejects.toThrow(
      "schema fetch failed: 500",
    )
    await expect(__test_schemaRequestService("https://app.example.com/schema.json")).rejects.toThrow(
      "schema fetch failed: 500",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(__test_getSchemaFailureTtlMs() + 1)
    await __test_schemaRequestService("https://app.example.com/schema.json")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("dedupes concurrent schema fetches", async () => {
    stubWindow()
    let resolveFetch: (value: FetchResponse) => void
    const gate = new Promise<FetchResponse>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => gate)
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    const first = __test_schemaRequestService("https://app.example.com/schema.json")
    const second = __test_schemaRequestService("https://app.example.com/schema.json")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch!({
      ok: true,
      status: 200,
      text: async () => "{}",
    })
    await expect(first).resolves.toBe("{}")
    await expect(second).resolves.toBe("{}")
  })

  it("expires schema cache by TTL", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    stubWindow()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "{}",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()
    await __test_schemaRequestService("https://app.example.com/schema.json")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(5 * 60 * 1000 + 1)
    await __test_schemaRequestService("https://app.example.com/schema.json")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("evicts least-recently-used schema entries", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    stubWindow()
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      text: async () => "{}",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService, __test_resetSchemaCache } = await import("~/components/editor/monaco-json-editor")
    __test_resetSchemaCache()

    for (let i = 0; i < 24; i += 1) {
      await __test_schemaRequestService(`${ORIGIN}/schema-${i}.json`)
    }
    await __test_schemaRequestService(`${ORIGIN}/schema-24.json`)
    await __test_schemaRequestService(`${ORIGIN}/schema-0.json`)
    expect(fetchMock).toHaveBeenCalledTimes(26)
  })
})
