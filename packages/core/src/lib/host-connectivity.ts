const IPV4_RE = /\b(\d{1,3})(?:\.(\d{1,3})){3}\b/;

function isIpv4Octet(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

export function isValidIpv4(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  const match = raw.match(IPV4_RE);
  if (!match) return false;
  const parts = raw.split(".").map((v) => Number.parseInt(v, 10));
  if (parts.length !== 4) return false;
  return parts.every(isIpv4Octet);
}

export function extractFirstIpv4(text: string): string | null {
  if (!text) return null;
  const match = text.match(IPV4_RE);
  if (!match) return null;
  const candidate = match[0] || "";
  return isValidIpv4(candidate) ? candidate : null;
}

export function normalizeSingleLineOutput(text: string): string {
  return String(text || "").trim().split(/\r?\n/)[0]?.trim() || "";
}

export function parseBootstrapIpv4Line(line: string): string | null {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  if (!/\bipv4\b/i.test(trimmed)) return null;
  return extractFirstIpv4(trimmed);
}

export function parseBootstrapIpv4FromLogs(lines: string[]): string | null {
  for (const line of lines) {
    const ipv4 = parseBootstrapIpv4Line(line);
    if (ipv4) return ipv4;
  }
  return null;
}

export function isTailscaleIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const parts = ip.split(".").map((v) => Number.parseInt(v, 10));
  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a === 100 && b >= 64 && b <= 127;
}
