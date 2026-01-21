import { describe, expect, it, vi } from "vitest"
import { mkdtemp } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

describe("resolveTemplateSpec errors", () => {
  it("rejects unsupported prefixes", async () => {
    const { resolveTemplateSpec } = await import("../src/server/template-spec")
    expect(() => resolveTemplateSpec("https://example.com/repo")).toThrow(/must start with/i)
  })

  it("throws when template source config missing", async () => {
    const prevCwd = process.cwd()
    const prevEnv = process.env["CLAWDLETS_TEMPLATE_SPEC"]
    const tempRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-template-missing-"))

    process.chdir(tempRoot)
    delete process.env["CLAWDLETS_TEMPLATE_SPEC"]
    vi.resetModules()

    try {
      const { resolveTemplateSpec } = await import("../src/server/template-spec")
      expect(() => resolveTemplateSpec()).toThrow(/template source config missing/i)
    } finally {
      process.chdir(prevCwd)
      if (prevEnv === undefined) delete process.env["CLAWDLETS_TEMPLATE_SPEC"]
      else process.env["CLAWDLETS_TEMPLATE_SPEC"] = prevEnv
    }
  })
})
