import fs from "node:fs/promises";
import path from "node:path";

function uniqNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export async function readClawdletsEnvTokens(repoRoot: string): Promise<string[]> {
  const envPath = path.join(repoRoot, ".clawdlets", "env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    const tokens: string[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const value = trimmed.slice(idx + 1).trim();
      if (!value) continue;
      tokens.push(value);
    }
    return uniqNonEmpty(tokens);
  } catch {
    return [];
  }
}

function scrubUrlCredentials(line: string): string {
  return line.replace(/(https?:\/\/)([^/\s@]+@)/g, "$1<redacted>@");
}

function scrubCommonSecrets(line: string): string {
  let out = line;
  out = out.replace(/(Authorization:\s*Bearer\s+)([^\s]+)/gi, "$1<redacted>");
  out = out.replace(/(Authorization:\s*Basic\s+)([^\s]+)/gi, "$1<redacted>");
  out = out.replace(
    /([?&](?:access_token|token|auth|api_key|apikey|apiKey)=)([^&\s]+)/gi,
    "$1<redacted>",
  );
  out = out.replace(
    /\b((?:access|refresh|id)?_?token|token|api_key|apikey|apiKey|secret|password)\s*[:=]\s*([^\s]+)/gi,
    "$1=<redacted>",
  );
  return out;
}

export function redactLine(line: string, tokens: string[]): string {
  let out = scrubCommonSecrets(scrubUrlCredentials(line));
  if (tokens.length === 0) return out;
  for (const token of tokens) {
    if (token.length < 4) continue;
    out = out.split(token).join("<redacted>");
  }
  return out;
}
