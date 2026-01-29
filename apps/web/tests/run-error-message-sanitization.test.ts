import { describe, expect, it, vi } from "vitest"

describe("run error message sanitization", () => {
  it("stores fallback message for unsafe errors", async () => {
    vi.resetModules()
    const mutation = vi.fn(async () => null)
    vi.doMock("~/server/run-manager", () => ({
      runWithEvents: async () => {
        throw new Error("permission denied: /etc/hosts")
      },
    }))

    const { runWithEventsAndStatus } = await import("~/sdk/run-with-events")

    const res = await runWithEventsAndStatus({
      client: { mutation } as any,
      runId: "run1" as any,
      redactTokens: [],
      fn: async () => {},
      onSuccess: () => ({ ok: true as const }),
      onError: (message) => ({ ok: false as const, message }),
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toBe("run failed")
    }

    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.errorMessage).toBe("run failed")
  })
})
