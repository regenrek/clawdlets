import { describe, expect, it } from "vitest";
import { parseClawdbotSchemaArtifact } from "../src/lib/clawdbot-schema.js";

describe("clawdbot schema artifact parse", () => {
  it("accepts valid artifact", () => {
    const res = parseClawdbotSchemaArtifact({
      schema: { type: "object" },
      uiHints: { title: "ok" },
      version: "1.0.0",
      generatedAt: "now",
      clawdbotRev: "rev123",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects missing required fields", () => {
    const res = parseClawdbotSchemaArtifact({ schema: {}, uiHints: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("schema payload missing required fields");
    }
  });
});
