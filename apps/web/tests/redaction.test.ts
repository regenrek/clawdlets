import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

import { readClawdletsEnvTokens, redactLine } from "../src/server/redaction"

describe("readClawdletsEnvTokens", () => {
  it("extracts unique values from .clawdlets/env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawdlets-web-redaction-"))
    await mkdir(path.join(root, ".clawdlets"), { recursive: true })
    await writeFile(
      path.join(root, ".clawdlets", "env"),
      [
        "# comment",
        "",
        "HCLOUD_TOKEN=abc12345",
        "EMPTY=",
        "SPACED =  abc12345  ",
        "SHORT=abc",
      ].join("\n"),
      "utf8",
    )

    const tokens = await readClawdletsEnvTokens(root)
    expect(tokens).toEqual(["abc12345", "abc"])
  })
})

describe("redactLine", () => {
  it("redacts tokens >= 4 chars", () => {
    expect(redactLine("token abc12345 here", ["abc12345"])).toBe("token <redacted> here")
    expect(redactLine("abc", ["abc"])).toBe("abc")
    expect(redactLine("abc12345 abc12345", ["abc12345"])).toBe("<redacted> <redacted>")
  })
})

