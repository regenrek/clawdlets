import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { __test_parseLiveSchemaTarget } from "../convex/projects"

function expectConvexFail(fn: () => void, code: string, message?: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
    if (message) expect((err as any).data?.message).toBe(message)
  }
}

describe("guardLiveSchemaFetch validation", () => {
  it("rejects oversized host", () => {
    expectConvexFail(
      () => __test_parseLiveSchemaTarget({ host: "a".repeat(129), botId: "bot1" }),
      "conflict",
      "host too long",
    )
  })

  it("rejects oversized botId", () => {
    expectConvexFail(
      () => __test_parseLiveSchemaTarget({ host: "host1", botId: "b".repeat(129) }),
      "conflict",
      "botId too long",
    )
  })

  it("accepts valid host/botId", () => {
    expect(__test_parseLiveSchemaTarget({ host: "host-1", botId: "bot_1" })).toEqual({
      host: "host-1",
      botId: "bot_1",
    })
  })
})
