const DISALLOWED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function assertSafeParts(parts: readonly string[]): void {
  if (parts.length === 0) throw new Error("empty path");
  for (const part of parts) {
    const p = part.trim();
    if (!p) throw new Error("empty path segment");
    if (DISALLOWED_SEGMENTS.has(p)) throw new Error(`invalid path segment: ${p}`);
  }
}

export function getAtPath(obj: unknown, parts: string[]): unknown {
  assertSafeParts(parts);
  let cur: any = obj;
  for (const k of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setAtPath(obj: any, parts: string[], value: unknown): void {
  assertSafeParts(parts);
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur == null || typeof cur !== "object") throw new Error("cannot set path on non-object");
    if (cur[k] == null || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  const last = parts[parts.length - 1]!;
  if (cur == null || typeof cur !== "object") throw new Error("cannot set path on non-object");
  cur[last] = value;
}

export function deleteAtPath(obj: any, parts: string[]): boolean {
  assertSafeParts(parts);
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur == null || typeof cur !== "object") return false;
    cur = cur[k];
  }
  const last = parts[parts.length - 1]!;
  if (cur && typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, last)) {
    delete cur[last];
    return true;
  }
  return false;
}

