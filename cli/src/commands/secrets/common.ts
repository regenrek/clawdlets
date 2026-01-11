import fs from "node:fs";
import path from "node:path";

export function sanitizeOperatorId(raw: string): string {
  return (
    String(raw || "operator")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_") || "operator"
  );
}

export function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim());
}

export function requireTargetHost(targetHost: string, hostName: string): string {
  const v = targetHost.trim();
  if (v) return v;
  throw new Error(
    [
      `missing target host for ${hostName}`,
      "set it in .clawdlets/stack.json (hosts.<host>.targetHost) or pass --target-host",
      "recommended: use an SSH config alias (e.g. botsmj)",
    ].join("; "),
  );
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function upsertYamlScalarLine(params: { text: string; key: string; value: string }): string {
  const { text, key, value } = params;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`^\\s*${escaped}\\s*:\\s*.*$`, "m");
  const line = `${key}: ${quoteYamlString(value)}`;
  if (rx.test(text)) return text.replace(rx, line);
  return `${text.trimEnd()}\n${line}\n`;
}

export function readDotenvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line0 of raw.split("\n")) {
    const line = line0.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

export function nextBackupPath(filePath: string): string {
  const base = `${filePath}.bak`;
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 50; i++) {
    const p0 = `${base}.${i}`;
    if (!fs.existsSync(p0)) return p0;
  }
  return `${base}.${Date.now()}`;
}

export function isPlaceholder(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (s === "<OPTIONAL>") return false;
  return /^<[^>]+>$/.test(s);
}

export function resolveRepoRootFromStackDir(stackDir: string): string {
  return path.resolve(stackDir, "..");
}

