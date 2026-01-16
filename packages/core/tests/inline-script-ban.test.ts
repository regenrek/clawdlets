import { describe, it, expect } from "vitest";
import path from "node:path";
import { findInlineScriptingViolations } from "../src/lib/inline-script-ban";

describe("inline scripting ban", () => {
  it("rejects inline python/node in infra/scripts", () => {
    const repoRoot = path.resolve(process.env.CLAWDLETS_TEMPLATE_DIR || path.join(__dirname, ".template"));
    const violations = findInlineScriptingViolations({ repoRoot });
    expect(violations).toEqual([]);
  });
});
