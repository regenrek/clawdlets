import { describe, expect, it } from "vitest"

import { resolveTemplateSpec } from "../src/server/template-spec"

describe("resolveTemplateSpec", () => {
  it("uses pinned github spec by default", () => {
    const prev = process.env["CLAWDLETS_TEMPLATE_SPEC"]
    delete process.env["CLAWDLETS_TEMPLATE_SPEC"]
    try {
      const spec = resolveTemplateSpec()
      expect(spec.startsWith("github:")).toBe(true)
      expect(spec).toMatch(/\/templates\/default#[0-9a-f]{40}$/)
    } finally {
      if (prev === undefined) delete process.env["CLAWDLETS_TEMPLATE_SPEC"]
      else process.env["CLAWDLETS_TEMPLATE_SPEC"] = prev
    }
  })

  it("prefers explicit input", () => {
    const spec = resolveTemplateSpec(
      `github:example/repo/templates/default#${"a".repeat(40)}`,
    )
    expect(spec).toBe(`github:example/repo/templates/default#${"a".repeat(40)}`)
  })

  it("rejects repo shorthand", () => {
    expect(() => resolveTemplateSpec("regenrek/clawdlets-template")).toThrow(
      /must be a giget spec/i,
    )
  })
})

