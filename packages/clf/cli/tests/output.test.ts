import { describe, expect, it, vi } from "vitest";
import { formatTable, printJson } from "../src/lib/output.js";

describe("clf cli output", () => {
  it("formats tables and handles empty rows", () => {
    expect(formatTable([])).toBe("");
    const out = formatTable([
      ["JOB", "STATUS"],
      ["abc", "queued"],
    ]);
    expect(out).toBe("JOB  STATUS\nabc  queued");
  });

  it("prints json to stdout", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printJson({ ok: true });
    expect(writeSpy).toHaveBeenCalledWith('{\n  \"ok\": true\n}\n');
    writeSpy.mockRestore();
  });
});
