import { describe, expect, it, vi } from "vitest"

describe("runWithEventsAndStatus", () => {
  it("sanitizes unsafe error message before persisting", async () => {
    vi.resetModules()
    const mutation = vi.fn(async (_mutation: unknown, _payload?: { status?: string; errorMessage?: string }) => null)
    vi.doMock("~/server/run-manager", () => ({
      runWithEvents: async () => {
        throw new Error("permission denied: /etc/hosts")
      },
    }))

    const { runWithEventsAndStatus } = await import("~/sdk/run-with-events")

    type Result = { ok: true } | { ok: false; message: string }
    const res = await runWithEventsAndStatus<Result>({
      client: { mutation } as any,
      runId: "run1" as any,
      redactTokens: [],
      fn: async () => {},
      onSuccess: () => ({ ok: true }),
      onError: (message) => ({ ok: false, message }),
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
