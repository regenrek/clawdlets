import { describe, expect, it } from "vitest"

import { seo } from "../src/utils/seo"

describe("seo", () => {
  it("includes base tags", () => {
    const tags = seo({ title: "Clawdlets", description: "Desc", keywords: "k1,k2" })
    expect(tags).toEqual(
      expect.arrayContaining([
        { title: "Clawdlets" },
        { name: "description", content: "Desc" },
        { name: "keywords", content: "k1,k2" },
        { name: "twitter:title", content: "Clawdlets" },
        { name: "og:title", content: "Clawdlets" },
      ]),
    )
  })

  it("adds image tags when provided", () => {
    const tags = seo({ title: "Clawdlets", image: "https://cdn.example.com/og.png" })
    expect(tags).toEqual(
      expect.arrayContaining([
        { name: "twitter:image", content: "https://cdn.example.com/og.png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "og:image", content: "https://cdn.example.com/og.png" },
      ]),
    )
  })
})
