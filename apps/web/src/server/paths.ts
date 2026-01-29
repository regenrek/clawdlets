import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

const WORKSPACE_ROOT_ENV = "CLAWDLETS_WORKSPACE_ROOTS";
let cachedWorkspaceRoots: { key: string; roots: string[] } | null = null;

export function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("path required");
  if (trimmed.includes("\u0000")) throw new Error("invalid path");

  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;

  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

type RepoRootValidationOptions = {
  allowMissing?: boolean;
  requireRepoLayout?: boolean;
};

function parseWorkspaceRoots(): string[] {
  const raw = String(process.env[WORKSPACE_ROOT_ENV] || "").trim();
  const cacheKey = `${raw}::${process.env.NODE_ENV || ""}`;
  if (cachedWorkspaceRoots && cachedWorkspaceRoots.key === cacheKey) return cachedWorkspaceRoots.roots;
  const roots = raw ? raw.split(path.delimiter) : [path.join(os.homedir(), "projects")];
  const testRoots =
    process.env.NODE_ENV === "test" ? [os.tmpdir(), "/tmp"] : [];
  const candidates = raw ? roots : [...roots, ...testRoots];
  const normalized: string[] = [];
  for (const entry of candidates) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const resolved = resolveUserPath(trimmed);
    const absolute = path.resolve(resolved);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (!stat.isDirectory()) continue;
    const real = fs.realpathSync(absolute);
    if (!normalized.includes(real)) normalized.push(real);
  }
  if (normalized.length === 0) {
    throw new Error("workspace roots not configured");
  }
  cachedWorkspaceRoots = { key: cacheKey, roots: normalized };
  return normalized;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function findExistingParent(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!fs.existsSync(current)) throw new Error("path does not exist");
  return current;
}

function resolveWithinWorkspacePath(target: string): string {
  const absolute = path.resolve(target);
  if (!path.isAbsolute(absolute)) throw new Error("path must be absolute");
  if (absolute.includes("\u0000")) throw new Error("invalid path");

  const existingParent = findExistingParent(absolute);
  const realParent = fs.realpathSync(existingParent);
  const suffix = path.relative(existingParent, absolute);
  const resolved = suffix ? path.join(realParent, suffix) : realParent;

  const roots = parseWorkspaceRoots();
  const inRoot = roots.some((root) => isWithinRoot(resolved, root));
  if (!inRoot) throw new Error("path outside allowed workspace roots");
  return resolved;
}

export function assertRepoRootPath(repoRoot: string, options: RepoRootValidationOptions = {}): string {
  const resolved = resolveWithinWorkspacePath(repoRoot);
  const allowMissing = options.allowMissing === true;
  const requireRepoLayout = options.requireRepoLayout === true;

  if (!allowMissing || requireRepoLayout) {
    if (!fs.existsSync(resolved)) throw new Error("path does not exist");
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error("path must be a directory");
  }

  if (requireRepoLayout) {
    const layout = getRepoLayout(resolved);
    if (!fs.existsSync(layout.clawdletsConfigPath)) {
      throw new Error(`missing fleet/clawdlets.json in ${resolved}`);
    }
  }

  return resolved;
}

export function resolveWorkspacePath(input: string, options: RepoRootValidationOptions = {}): string {
  const resolved = resolveUserPath(input);
  return assertRepoRootPath(resolved, options);
}
