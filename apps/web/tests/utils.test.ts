import { describe, expect, it } from "vitest"

import { cn } from "../src/lib/utils"

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("font-bold", false, "text-sm")).toBe("font-bold text-sm")
  })

  it("resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })
})
