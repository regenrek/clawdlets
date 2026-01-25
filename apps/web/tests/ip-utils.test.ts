import { describe, expect, it } from "vitest"

import { singleHostCidrFromIp } from "../src/lib/ip-utils"

describe("singleHostCidrFromIp", () => {
  it("formats IPv4 as /32", () => {
    expect(singleHostCidrFromIp("203.0.113.10")).toBe("203.0.113.10/32")
  })

  it("formats IPv6 as /128", () => {
    expect(singleHostCidrFromIp("2001:db8::1")).toBe("2001:db8::1/128")
  })

  it("trims input", () => {
    expect(singleHostCidrFromIp(" 203.0.113.10 ")).toBe("203.0.113.10/32")
  })

  it("throws on invalid ip", () => {
    expect(() => singleHostCidrFromIp("new")).toThrow(/invalid/i)
  })
})

