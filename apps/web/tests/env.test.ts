import { afterEach, describe, expect, it } from "vitest"

import {
  assertAuthNotDisabledInProd as assertWebAuthNotDisabledInProd,
  isAuthDisabled as isWebAuthDisabled,
} from "../src/server/env"
import {
  assertAuthNotDisabledInProd as assertConvexAuthNotDisabledInProd,
  isAuthDisabled as isConvexAuthDisabled,
} from "../convex/lib/env"

const envKeys = [
  "CLAWDLETS_AUTH_DISABLED",
  "VITE_CLAWDLETS_AUTH_DISABLED",
  "NODE_ENV",
  "CONVEX_DEPLOYMENT",
] as const

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("server env", () => {
  it("reads CLAWDLETS_AUTH_DISABLED + VITE fallback", () => {
    delete process.env["CLAWDLETS_AUTH_DISABLED"]
    delete process.env["VITE_CLAWDLETS_AUTH_DISABLED"]
    expect(isWebAuthDisabled()).toBe(false)

    process.env["VITE_CLAWDLETS_AUTH_DISABLED"] = "yes"
    expect(isWebAuthDisabled()).toBe(true)

    process.env["CLAWDLETS_AUTH_DISABLED"] = "true"
    process.env["VITE_CLAWDLETS_AUTH_DISABLED"] = "no"
    expect(isWebAuthDisabled()).toBe(true)
  })

  it("blocks auth disable in production", () => {
    process.env["NODE_ENV"] = "production"
    process.env["CLAWDLETS_AUTH_DISABLED"] = "1"
    expect(() => assertWebAuthNotDisabledInProd()).toThrow(/not allowed/i)

    delete process.env["CLAWDLETS_AUTH_DISABLED"]
    delete process.env["VITE_CLAWDLETS_AUTH_DISABLED"]
    expect(() => assertWebAuthNotDisabledInProd()).not.toThrow()
  })
})

describe("convex env", () => {
  it("detects disabled auth", () => {
    process.env["CLAWDLETS_AUTH_DISABLED"] = "1"
    expect(isConvexAuthDisabled()).toBe(true)

    process.env["CLAWDLETS_AUTH_DISABLED"] = "true"
    expect(isConvexAuthDisabled()).toBe(true)

    process.env["CLAWDLETS_AUTH_DISABLED"] = "yes"
    expect(isConvexAuthDisabled()).toBe(true)

    process.env["CLAWDLETS_AUTH_DISABLED"] = "0"
    expect(isConvexAuthDisabled()).toBe(false)
  })

  it("blocks auth disable outside dev deployments", () => {
    process.env["CLAWDLETS_AUTH_DISABLED"] = "true"
    process.env["CONVEX_DEPLOYMENT"] = "prod:abc"
    expect(() => assertConvexAuthNotDisabledInProd()).toThrow(/not allowed/i)

    process.env["CONVEX_DEPLOYMENT"] = "dev:abc"
    expect(() => assertConvexAuthNotDisabledInProd()).not.toThrow()

    delete process.env["CONVEX_DEPLOYMENT"]
    expect(() => assertConvexAuthNotDisabledInProd()).not.toThrow()
  })
})
