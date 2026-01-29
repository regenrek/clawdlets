import { describe, expect, it, vi, afterEach } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("clawdbot parse scheduler", () => {
  it("debounces parsing and linting", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const lintSpy = vi.fn(() => ({ ok: true }))
    vi.doMock("@clawdlets/core/lib/clawdbot-security-lint", () => ({
      lintClawdbotSecurityConfig: lintSpy,
    }))
    const mod = await import("~/lib/clawdbot-parse")
    let text = "{}"
    const onParsed = vi.fn()
    const onSecurity = vi.fn()
    const scheduler = mod.createClawdbotParseScheduler({
      getText: () => text,
      getBotId: () => "bot1",
      onParsed,
      onSecurity,
      delayMs: 200,
      timeoutMs: 500,
    })

    text = "{"
    scheduler.schedule()
    text = "{\"ok\":1}"
    scheduler.schedule()
    text = "{\"ok\":2}"
    scheduler.schedule()

    await vi.runAllTimersAsync()
    expect(onParsed).toHaveBeenCalledTimes(1)
    expect(lintSpy).toHaveBeenCalledTimes(1)
    scheduler.cancel()
  })
})
