export type ConfigDiffEntry = {
  path: string;
  before: JsonValue;
  after: JsonValue;
  change: "added" | "removed" | "changed";
};

// JSON-safe value type for diff payloads (serverfn return values must serialize cleanly).
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map((v) => toJsonValue(v));
  if (isPlainObject(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJsonValue(v);
    return out;
  }
  // Fallback for non-JSON values (functions, symbols, etc).
  return String(value);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!valuesEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function diffValues(before: unknown, after: unknown, path: string, out: ConfigDiffEntry[]): void {
  if (valuesEqual(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of Array.from(keys).sort()) {
      const nextPath = path ? `${path}.${key}` : key;
      diffValues(before[key], after[key], nextPath, out);
    }
    return;
  }

  if (before === undefined) {
    out.push({ path, before: toJsonValue(before), after: toJsonValue(after), change: "added" });
    return;
  }
  if (after === undefined) {
    out.push({ path, before: toJsonValue(before), after: toJsonValue(after), change: "removed" });
    return;
  }
  out.push({ path, before: toJsonValue(before), after: toJsonValue(after), change: "changed" });
}

export function diffConfig(before: unknown, after: unknown, basePath = ""): ConfigDiffEntry[] {
  const out: ConfigDiffEntry[] = [];
  diffValues(before, after, basePath, out);
  return out;
}
