import { describe, expect, it } from "vitest";
import {
  summarizeClawdbotSchemaComparison,
  type ClawdbotSchemaComparison,
} from "../src/lib/clawdbot-schema-compare.js";

describe("clawdbot schema comparison summary", () => {
  it("summarizes pinned ok and upstream error", () => {
    const comparison: ClawdbotSchemaComparison = {
      schemaVersion: "1.0.0",
      schemaRev: "rev123",
      warnings: ["warn1"],
      pinned: { ok: true, nixClawdbotRev: "pinrev", clawdbotRev: "rev123", matches: true },
      upstream: { ok: false, nixClawdbotRef: "main", error: "rate limited" },
    };
    const summary = summarizeClawdbotSchemaComparison(comparison);
    expect(summary.pinned?.status).toBe("ok");
    expect(summary.upstream.ok).toBe(false);
    expect(summary.upstream.status).toBe("warn");
    expect(summary.warnings).toEqual(["warn1"]);
  });

  it("marks mismatch as warn with details", () => {
    const comparison: ClawdbotSchemaComparison = {
      schemaVersion: "2.0.0",
      schemaRev: "rev000",
      warnings: [],
      pinned: { ok: true, nixClawdbotRev: "pinrev", clawdbotRev: "rev999", matches: false },
      upstream: { ok: true, nixClawdbotRef: "main", clawdbotRev: "rev999", matches: false },
    };
    const summary = summarizeClawdbotSchemaComparison(comparison);
    expect(summary.pinned?.status).toBe("warn");
    expect(summary.upstream.status).toBe("warn");
  });
});
