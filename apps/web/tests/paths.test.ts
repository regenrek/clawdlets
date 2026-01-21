import { describe, expect, it } from "vitest"
import os from "node:os"
import path from "node:path"

import { resolveUserPath } from "../src/server/paths"

describe("resolveUserPath", () => {
  it("expands ~ and ~/ paths", () => {
    expect(resolveUserPath("~")).toBe(os.homedir())
    expect(resolveUserPath("~/clawdlets")).toBe(path.join(os.homedir(), "clawdlets"))
  })

  it("resolves relative paths from cwd", () => {
    const cwd = process.cwd()
    expect(resolveUserPath("config/test.json")).toBe(path.resolve(cwd, "config/test.json"))
  })

  it("accepts absolute paths", () => {
    const absolute = path.resolve("/tmp")
    expect(resolveUserPath(absolute)).toBe(absolute)
  })

  it("rejects empty or null-byte paths", () => {
    expect(() => resolveUserPath(" ")).toThrow(/path required/i)
    expect(() => resolveUserPath("bad\u0000path")).toThrow(/invalid path/i)
  })
})
