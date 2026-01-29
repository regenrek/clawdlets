import { describe, expect, it, vi } from "vitest"
import { createDebouncedIdleRunner } from "~/lib/idle-debounce"

describe("createDebouncedIdleRunner", () => {
  it("debounces multiple schedule calls", () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const fn = vi.fn()
    const runner = createDebouncedIdleRunner({ fn, delayMs: 200 })
    runner.schedule()
    runner.schedule()
    runner.schedule()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(1)
    runner.cancel()
    vi.useRealTimers()
  })
})
