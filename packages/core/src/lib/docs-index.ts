import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type DocsIndexEntry = {
  path: string;
  when?: string;
  summary?: string;
};

function isSafeRelativePath(p: string): boolean {
  if (!p) return false;
  if (path.isAbsolute(p)) return false;
  const parts = p.split(/[\\/]+/g).filter(Boolean);
  if (parts.includes("..")) return false;
  return true;
}

function normalizeEntry(raw: unknown): DocsIndexEntry {
  if (!raw || typeof raw !== "object") throw new Error("docs entry must be an object");
  const any = raw as Record<string, unknown>;
  const p0 = String(any.path ?? "");
  if (!p0) throw new Error("docs entry missing path");
  if (!isSafeRelativePath(p0)) throw new Error(`docs entry path must be a safe relative path: ${p0}`);
  if (!p0.replace(/\\/g, "/").startsWith("docs/")) throw new Error(`docs entry path must start with docs/: ${p0}`);

  const when = any.when == null ? undefined : String(any.when);
  const summary = any.summary == null ? undefined : String(any.summary);
  return { path: p0.replace(/\\/g, "/"), when, summary };
}

function readDocsIndex(filePath: string): DocsIndexEntry[] {
  if (!fs.existsSync(filePath)) throw new Error(`missing docs index: ${filePath}`);
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as { docs?: unknown };
  if (!raw || typeof raw !== "object") throw new Error(`docs index must be a YAML object: ${filePath}`);
  if (!Array.isArray(raw.docs)) throw new Error(`docs index must contain docs: []: ${filePath}`);
  return raw.docs.map(normalizeEntry);
}

function ensureUniquePaths(entries: DocsIndexEntry[], label: string): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const e of entries) {
    if (seen.has(e.path)) dupes.push(e.path);
    seen.add(e.path);
  }
  return dupes.length > 0 ? [`${label} has duplicate path(s): ${Array.from(new Set(dupes)).join(", ")}`] : [];
}

function entriesEqual(a: DocsIndexEntry[], b: DocsIndexEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ea = a[i]!;
    const eb = b[i]!;
    if (ea.path !== eb.path) return false;
    if ((ea.when ?? "") !== (eb.when ?? "")) return false;
    if ((ea.summary ?? "") !== (eb.summary ?? "")) return false;
  }
  return true;
}

export function validateDocsIndexIntegrity(params: {
  repoRoot: string;
  templateRoot?: string | null;
}): { ok: boolean; errors: string[] } {
  const repoRoot = params.repoRoot;

  const repoIndexPath = path.join(repoRoot, "docs", "docs.yaml");
  const templateIndexPath = params.templateRoot ? path.join(params.templateRoot, "docs", "docs.yaml") : null;

  const errors: string[] = [];

  let repoEntries: DocsIndexEntry[] = [];
  let templateEntries: DocsIndexEntry[] = [];

  try {
    repoEntries = readDocsIndex(repoIndexPath);
  } catch (e) {
    errors.push(String((e as Error)?.message || e));
  }

  if (templateIndexPath) {
    try {
      templateEntries = readDocsIndex(templateIndexPath);
    } catch (e) {
      errors.push(String((e as Error)?.message || e));
    }
  }

  errors.push(...ensureUniquePaths(repoEntries, "docs/docs.yaml"));
  if (templateIndexPath) {
    errors.push(...ensureUniquePaths(templateEntries, path.relative(repoRoot, templateIndexPath)));
  }

  for (const e of repoEntries) {
    const abs = path.join(repoRoot, e.path);
    if (!fs.existsSync(abs)) errors.push(`docs/docs.yaml references missing file: ${e.path}`);
  }
  if (templateIndexPath) {
    for (const e of templateEntries) {
      const abs = path.join(params.templateRoot as string, e.path);
      if (!fs.existsSync(abs)) errors.push(`template docs.yaml references missing file: ${e.path}`);
    }
  }

  if (templateIndexPath && repoEntries.length > 0 && templateEntries.length > 0 && !entriesEqual(repoEntries, templateEntries)) {
    errors.push("docs index mismatch: docs/docs.yaml must match template docs/docs.yaml (paths + metadata + order)");
  }

  return { ok: errors.length === 0, errors };
}
