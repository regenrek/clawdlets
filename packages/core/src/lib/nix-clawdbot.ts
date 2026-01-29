import fs from "node:fs";
import path from "node:path";

export type NixClawdbotSourceInfo = {
  rev: string;
  hash?: string;
  pnpmDepsHash?: string;
};

export type NixClawdbotSourceFetchResult =
  | { ok: true; info: NixClawdbotSourceInfo; sourceUrl: string }
  | { ok: false; error: string; sourceUrl: string };

function stripComments(contents: string): string {
  const withoutBlock = contents.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/(^|[^\\])#.*$/gm, "$1");
}

function decodeNixString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    const body = trimmed.slice(1, -1);
    return body.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const body = trimmed.slice(1, -1);
    return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function matchAttr(contents: string, name: string): string | null {
  const pattern = `\\b${name}\\s*=\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')\\s*;`;
  const regex = new RegExp(pattern, "m");
  const match = regex.exec(contents);
  if (!match) return null;
  const value = decodeNixString(match[1] || "");
  return value ? value : null;
}

export function parseNixClawdbotSource(contents: string): NixClawdbotSourceInfo | null {
  const sanitized = stripComments(contents);
  const rev = matchAttr(sanitized, "rev");
  if (!rev) return null;
  const hash = matchAttr(sanitized, "hash") || undefined;
  const pnpmDepsHash = matchAttr(sanitized, "pnpmDepsHash") || undefined;
  return { rev, hash, pnpmDepsHash };
}

export function getNixClawdbotRevFromFlakeLock(repoRoot: string): string | null {
  const flakeLockPath = path.join(repoRoot, "flake.lock");
  if (!fs.existsSync(flakeLockPath)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(flakeLockPath, "utf8"));
    const rev = lock?.nodes?.["nix-clawdbot"]?.locked?.rev;
    return typeof rev === "string" && rev.trim() ? rev.trim() : null;
  } catch {
    return null;
  }
}

const SAFE_REF_RE = /^[A-Za-z0-9._/-]{1,128}$/;

function buildSourceUrl(ref: string): string {
  return `https://raw.githubusercontent.com/clawdbot/nix-clawdbot/${ref}/nix/sources/clawdbot-source.nix`;
}

export async function fetchNixClawdbotSourceInfo(params: {
  ref: string;
  timeoutMs?: number;
}): Promise<NixClawdbotSourceFetchResult> {
  if (typeof params.ref !== "string") {
    return { ok: false, error: "invalid nix-clawdbot ref", sourceUrl: "" };
  }
  const safeRef = params.ref.trim() || "main";
  if (!SAFE_REF_RE.test(safeRef)) {
    return { ok: false, error: "invalid nix-clawdbot ref", sourceUrl: "" };
  }
  const sourceUrl = buildSourceUrl(safeRef);
  if (typeof fetch !== "function") {
    return { ok: false, error: "fetch unavailable in runtime", sourceUrl };
  }
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: `http ${res.status}`, sourceUrl };
    }
    const raw = await res.text();
    const parsed = parseNixClawdbotSource(raw);
    if (!parsed) return { ok: false, error: "unable to parse clawdbot-source.nix", sourceUrl };
    return { ok: true, info: parsed, sourceUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, sourceUrl };
  } finally {
    clearTimeout(timer);
  }
}
