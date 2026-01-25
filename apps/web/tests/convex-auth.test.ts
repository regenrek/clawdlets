import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { requireAdmin } from "../convex/lib/auth"

describe("requireAdmin", () => {
  it("throws forbidden for viewer", () => {
    try {
      requireAdmin("viewer")
      throw new Error("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError)
      expect((err as any).data?.code).toBe("forbidden")
    }
  })

  it("allows admin", () => {
    expect(() => requireAdmin("admin")).not.toThrow()
  })
})

