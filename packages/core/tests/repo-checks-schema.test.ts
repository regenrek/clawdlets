import { describe, expect, it } from "vitest";
import { checkSchemaVsNixClawdbot } from "../src/doctor/schema-checks.js";

describe("checkSchemaVsNixClawdbot", () => {
  it("reports pinned and upstream status", async () => {
    const schemaRev = "rev1234567890abcd";
    const checks = await checkSchemaVsNixClawdbot({
      repoRoot: "/tmp/repo",
      getPinnedSchema: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        clawdbotRev: schemaRev,
      }),
      getNixClawdbotRevFromFlakeLock: () => "pin-rev",
      fetchNixClawdbotSourceInfo: async ({ ref }) => {
        if (ref === "pin-rev") {
          return { ok: true as const, info: { rev: schemaRev }, sourceUrl: "x" };
        }
        if (ref === "main") {
          return { ok: true as const, info: { rev: "upstream123456789" }, sourceUrl: "x" };
        }
        return { ok: false as const, error: "missing", sourceUrl: "x" };
      },
    });

    const pinned = checks.find((c) => c.label === "clawdbot schema vs nix-clawdbot");
    const upstream = checks.find((c) => c.label === "clawdbot schema vs upstream");

    expect(pinned?.status).toBe("ok");
    expect(pinned?.detail).toContain(`rev=${schemaRev.slice(0, 12)}`);
    expect(upstream?.status).toBe("warn");
    expect(upstream?.detail).toContain("upstream=");
  });

  it("returns no checks when schema rev missing", async () => {
    const checks = await checkSchemaVsNixClawdbot({
      repoRoot: "/tmp/repo",
      getPinnedSchema: () => ({
        schema: {},
        uiHints: {},
        version: "",
        generatedAt: "",
        clawdbotRev: "",
      }),
      fetchNixClawdbotSourceInfo: async () => {
        throw new Error("should not fetch");
      },
    });

    expect(checks).toEqual([]);
  });
});
