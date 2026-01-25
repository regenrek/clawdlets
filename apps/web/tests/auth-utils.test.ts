import { describe, expect, it } from "vitest"

import { isAuthError } from "../src/lib/auth-utils"

describe("isAuthError", () => {
  it("detects convex unauthorized codes", () => {
    expect(isAuthError({ data: { code: "unauthorized" } })).toBe(true)
  })

  it("detects unauth message text", () => {
    expect(isAuthError({ message: "Unauthenticated" })).toBe(true)
  })

  it("returns false for non-auth errors", () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError({ message: "forbidden" })).toBe(false)
  })
})
