import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateDocsIndexIntegrity } from "../src/lib/docs-index";

describe("docs index integrity", () => {
  it("validates docs/docs.yaml in the repo", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it("reports missing repo docs index", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-docs-index-"));
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing docs index"))).toBe(true);
  });

  it("reports template mismatch when templateRoot is provided", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-docs-index-"));
    const templateRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-docs-template-"));
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await mkdir(path.join(templateRoot, "docs"), { recursive: true });

    await writeFile(path.join(repoRoot, "docs", "overview.md"), "# overview\n", "utf8");
    await writeFile(path.join(templateRoot, "docs", "overview.md"), "# overview\n", "utf8");

    await writeFile(
      path.join(repoRoot, "docs", "docs.yaml"),
      ["docs:", "  - path: docs/overview.md", "    when: seed", "    summary: seed", ""].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(templateRoot, "docs", "docs.yaml"),
      ["docs:", "  - path: docs/overview.md", "    when: seed", "    summary: different", ""].join("\n"),
      "utf8",
    );

    const mismatch = validateDocsIndexIntegrity({ repoRoot, templateRoot });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.some((e) => e.includes("docs index mismatch"))).toBe(true);
  });

  it("reports duplicates and missing referenced files", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-docs-index-"));
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });

    await writeFile(
      path.join(repoRoot, "docs", "docs.yaml"),
      [
        "docs:",
        "  - path: docs/missing.md",
        "    when: seed",
        "    summary: seed",
        "  - path: docs/missing.md",
        "    when: seed",
        "    summary: seed",
        "",
      ].join("\n"),
      "utf8",
    );

    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicate path"))).toBe(true);
    expect(r.errors.some((e) => e.includes("references missing file"))).toBe(true);
  });

  it("rejects invalid docs index structure", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-docs-index-"));
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });

    await writeFile(path.join(repoRoot, "docs", "docs.yaml"), "foo\n", "utf8");

    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("docs index must be a YAML object"))).toBe(true);
  });

  it("rejects unsafe docs entry paths", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-docs-index-"));
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });

    await writeFile(
      path.join(repoRoot, "docs", "docs.yaml"),
      ["docs:", "  - path: /etc/passwd", ""].join("\n"),
      "utf8",
    );

    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("safe relative path"))).toBe(true);
  });
});
