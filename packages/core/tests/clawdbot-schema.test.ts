import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const flakeLockPath = path.join(repoRoot, "flake.lock");

function readPinnedRev(): string {
  if (!fs.existsSync(flakeLockPath)) return "";
  const lock = JSON.parse(fs.readFileSync(flakeLockPath, "utf8"));
  return String(lock?.nodes?.["clawdbot-src"]?.locked?.rev || "").trim();
}

describe("clawdbot schema artifact", () => {
  it("includes schema metadata", async () => {
    const { getPinnedClawdbotSchema } = await import("../src/lib/clawdbot-schema");
    const schema = getPinnedClawdbotSchema();
    expect(schema).toBeTruthy();
    expect(schema.schema && typeof schema.schema).toBe("object");
    expect(schema.uiHints && typeof schema.uiHints).toBe("object");
    expect(typeof schema.version).toBe("string");
    expect(schema.version.length).toBeGreaterThan(0);
    expect(typeof schema.generatedAt).toBe("string");
    expect(schema.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof schema.clawdbotRev).toBe("string");
    expect(schema.clawdbotRev?.match(/^[0-9a-f]{7,}$/)).toBeTruthy();
    const pinnedRev = readPinnedRev();
    if (pinnedRev) expect(schema.clawdbotRev).toBe(pinnedRev);
  });
});
