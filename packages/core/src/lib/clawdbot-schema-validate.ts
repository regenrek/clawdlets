import type { ErrorObject } from "ajv";
import { createHash } from "node:crypto";
import Ajv2020Module from "ajv/dist/2020.js";
import draft7Meta from "ajv/dist/refs/json-schema-draft-07.json" with { type: "json" };
import { getPinnedClawdbotSchema } from "./clawdbot-schema.js";

type AjvValidate = import("ajv").ValidateFunction;

export type ClawdbotSchemaValidationIssue = {
  path: Array<string | number>;
  message: string;
  keyword?: string;
  instancePath?: string;
  schemaPath?: string;
};

export type ClawdbotSchemaValidation = {
  ok: boolean;
  errors: string[];
  issues: ClawdbotSchemaValidationIssue[];
};

const pinnedSchema = getPinnedClawdbotSchema().schema as Record<string, unknown>;
let cachedAjv: import("ajv").default | null = null;
let validatorCacheBySchema: WeakMap<object, AjvValidate> = new WeakMap();
let validatorCacheByFingerprint: Map<string, AjvValidate> = new Map();
let compileCount = 0;
const VALIDATOR_CACHE_MAX = 32;

function formatAjvError(err: ErrorObject): string {
  const pathBase = err.instancePath ? err.instancePath.replace(/^\//, "").replaceAll("/", ".") : "(root)";
  if (err.keyword === "required" && typeof (err.params as { missingProperty?: unknown })?.missingProperty === "string") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return `${pathBase === "(root)" ? missing : `${pathBase}.${missing}`}: ${err.message ?? "required"}`;
  }
  return `${pathBase}: ${err.message ?? "invalid"}`;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parseInstancePath(path: string): Array<string | number> {
  if (!path) return [];
  return path
    .split("/")
    .slice(1)
    .map((segment) => decodeJsonPointerSegment(segment))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function buildIssue(err: ErrorObject): ClawdbotSchemaValidationIssue {
  const basePath = parseInstancePath(err.instancePath || "");
  let path = basePath;
  if (err.keyword === "required" && typeof (err.params as { missingProperty?: unknown })?.missingProperty === "string") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    if (missing) path = [...basePath, missing];
  }
  if (err.keyword === "additionalProperties" && typeof (err.params as { additionalProperty?: unknown })?.additionalProperty === "string") {
    const extra = (err.params as { additionalProperty?: string }).additionalProperty;
    if (extra) path = [...basePath, extra];
  }
  if (err.keyword === "unevaluatedProperties" && typeof (err.params as { unevaluatedProperty?: unknown })?.unevaluatedProperty === "string") {
    const extra = (err.params as { unevaluatedProperty?: string }).unevaluatedProperty;
    if (extra) path = [...basePath, extra];
  }
  if (err.keyword === "propertyNames" && typeof (err.params as { propertyName?: unknown })?.propertyName === "string") {
    const prop = (err.params as { propertyName?: string }).propertyName;
    if (prop) path = [...basePath, prop];
  }
  return {
    path,
    message: formatAjvError(err),
    keyword: err.keyword,
    instancePath: err.instancePath,
    schemaPath: err.schemaPath,
  };
}

function hashValue(value: unknown, hash: ReturnType<typeof createHash>, stack: WeakSet<object>) {
  if (value === null) {
    hash.update("null");
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    hash.update(JSON.stringify(value));
    return;
  }
  if (typeof value === "bigint") {
    hash.update(`bigint:${value.toString()}`);
    return;
  }
  if (Array.isArray(value)) {
    hash.update("[");
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) hash.update(",");
      hashValue(value[i], hash, stack);
    }
    hash.update("]");
    return;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (stack.has(obj)) throw new Error("circular schema");
    stack.add(obj);
    const entries = Object.entries(obj)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => a.localeCompare(b));
    hash.update("{");
    for (let i = 0; i < entries.length; i += 1) {
      const [key, val] = entries[i]!;
      if (i > 0) hash.update(",");
      hash.update(JSON.stringify(key));
      hash.update(":");
      hashValue(val, hash, stack);
    }
    hash.update("}");
    stack.delete(obj);
    return;
  }
  hash.update(JSON.stringify(String(value)));
}

function fingerprintSchema(schema: Record<string, unknown>): string | null {
  try {
    const hash = createHash("sha256");
    hashValue(schema, hash, new WeakSet<object>());
    return hash.digest("hex");
  } catch {
    return null;
  }
}

function capCache<T>(cache: Map<string, T>, maxSize: number) {
  if (cache.size <= maxSize) return;
  const overflow = cache.size - maxSize;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function touchCache<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
}

function buildAjv(): import("ajv").default {
  const Ajv2020 = Ajv2020Module as unknown as typeof import("ajv/dist/2020.js").default;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: false,
    unevaluated: true,
  });
  ajv.addMetaSchema(draft7Meta);
  return ajv;
}

function getAjv(): import("ajv").default {
  if (!cachedAjv) cachedAjv = buildAjv();
  return cachedAjv;
}

function compileValidator(schema: Record<string, unknown>): AjvValidate {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id === "string") {
    const trimmed = id.trim();
    if (trimmed) getAjv().removeSchema(trimmed);
  }
  compileCount += 1;
  return getAjv().compile(schema);
}

function getValidator(schema: Record<string, unknown>): AjvValidate {
  const cachedBySchema = validatorCacheBySchema.get(schema);
  if (cachedBySchema) return cachedBySchema;
  const fingerprint = fingerprintSchema(schema);
  if (fingerprint) {
    const cachedByFingerprint = validatorCacheByFingerprint.get(fingerprint);
    if (cachedByFingerprint) {
      touchCache(validatorCacheByFingerprint, fingerprint, cachedByFingerprint);
      validatorCacheBySchema.set(schema, cachedByFingerprint);
      return cachedByFingerprint;
    }
  }
  const compiled = compileValidator(schema);
  validatorCacheBySchema.set(schema, compiled);
  if (fingerprint) {
    validatorCacheByFingerprint.set(fingerprint, compiled);
    capCache(validatorCacheByFingerprint, VALIDATOR_CACHE_MAX);
  }
  return compiled;
}

export function validateClawdbotConfig(value: unknown, schema?: Record<string, unknown>): ClawdbotSchemaValidation {
  const targetSchema = schema ?? pinnedSchema;
  const validate = getValidator(targetSchema);
  const ok = Boolean(validate(value));
  if (ok) return { ok: true, errors: [], issues: [] };
  const issues = (validate.errors || []).map(buildIssue);
  const errors = issues.map((issue) => issue.message);
  return { ok: false, errors, issues };
}

export function __test_resetValidatorCache(): void {
  cachedAjv = null;
  validatorCacheBySchema = new WeakMap();
  validatorCacheByFingerprint = new Map();
  compileCount = 0;
}

export function __test_getCompileCount(): number {
  return compileCount;
}

export function __test_getValidatorCacheMax(): number {
  return VALIDATOR_CACHE_MAX;
}
