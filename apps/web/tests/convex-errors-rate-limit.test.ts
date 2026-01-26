import { afterEach, describe, expect, it, vi } from "vitest"
import { ConvexError } from "convex/values"

import { fail } from "../convex/lib/errors"
import { rateLimit } from "../convex/lib/rateLimit"

type RateLimitRow = { _id: string; windowStart: number; count: number }

function makeCtx(existing: RateLimitRow | null) {
  const inserts: Array<{ table: string; doc: any }> = []
  const patches: Array<{ id: string; update: any }> = []
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, fn: any) => {
          fn({ eq: (_field: string, _value: any) => ({}) })
          return {
          unique: async () => existing,
          }
        },
      }),
      insert: async (table: string, doc: any) => {
        inserts.push({ table, doc })
        return "id1"
      },
      patch: async (id: string, update: any) => {
        patches.push({ id, update })
      },
    },
  }
  return { ctx, inserts, patches }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("fail", () => {
  it("throws ConvexError with code", () => {
    try {
      fail("forbidden", "nope", { extra: true })
      throw new Error("expected fail")
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError)
      expect((err as any).data).toMatchObject({ code: "forbidden", message: "nope", extra: true })
    }
  })
})

describe("rateLimit", () => {
  it("inserts on first hit", async () => {
    vi.useFakeTimers()
    const now = 1_000_000
    vi.setSystemTime(now)
    const windowMs = 1000
    const windowStart = Math.floor(now / windowMs) * windowMs
    const { ctx, inserts } = makeCtx(null)

    await rateLimit({ ctx: ctx as any, key: "k1", limit: 3, windowMs })

    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.doc).toMatchObject({ key: "k1", windowStart, count: 1 })
  })

  it("resets window counts", async () => {
    vi.useFakeTimers()
    const now = 2_000
    vi.setSystemTime(now)
    const windowMs = 1000
    const windowStart = Math.floor(now / windowMs) * windowMs
    const existing = { _id: "r1", windowStart: 1_000, count: 7 }
    const { ctx, patches } = makeCtx(existing)

    await rateLimit({ ctx: ctx as any, key: "k2", limit: 10, windowMs })

    expect(patches).toHaveLength(1)
    expect(patches[0]?.update).toMatchObject({ windowStart, count: 1 })
  })

  it("increments within the same window", async () => {
    vi.useFakeTimers()
    const now = 5_000
    vi.setSystemTime(now)
    const windowMs = 1000
    const windowStart = Math.floor(now / windowMs) * windowMs
    const existing = { _id: "r1", windowStart, count: 2 }
    const { ctx, patches } = makeCtx(existing)

    await rateLimit({ ctx: ctx as any, key: "k3", limit: 5, windowMs })

    expect(patches).toHaveLength(1)
    expect(patches[0]?.update).toMatchObject({ count: 3 })
  })

  it("throws when over limit", async () => {
    vi.useFakeTimers()
    const now = 7_000
    vi.setSystemTime(now)
    const windowMs = 1000
    const windowStart = Math.floor(now / windowMs) * windowMs
    const existing = { _id: "r1", windowStart, count: 3 }
    const { ctx } = makeCtx(existing)

    try {
      await rateLimit({ ctx: ctx as any, key: "k4", limit: 3, windowMs })
      throw new Error("expected rate limit")
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError)
      expect((err as any).data).toMatchObject({ code: "rate_limited", retryAt: windowStart + windowMs })
    }
  })
})
