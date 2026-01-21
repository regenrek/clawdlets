const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isUnsafeRecordKey(key: string): boolean {
  return UNSAFE_KEYS.has(key);
}

export function assertSafeRecordKey(params: { key: string; context: string }): void {
  if (!isUnsafeRecordKey(params.key)) return;
  throw new Error(`unsafe key "${params.key}" (${params.context})`);
}

export function createNullProtoRecord<TValue>(): Record<string, TValue> {
  return Object.create(null) as Record<string, TValue>;
}

