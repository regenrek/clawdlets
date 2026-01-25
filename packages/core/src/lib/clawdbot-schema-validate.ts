import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";
import { getPinnedClawdbotSchema } from "./clawdbot-schema.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;

type AjvValidate = import("ajv").ValidateFunction;

export type ClawdbotSchemaValidation = {
  ok: boolean;
  errors: string[];
};

let cachedValidator: AjvValidate | null = null;

function formatAjvError(err: ErrorObject): string {
  const pathBase = err.instancePath ? err.instancePath.replace(/^\//, "").replaceAll("/", ".") : "(root)";
  if (err.keyword === "required" && typeof (err.params as { missingProperty?: unknown })?.missingProperty === "string") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return `${pathBase === "(root)" ? missing : `${pathBase}.${missing}`}: ${err.message ?? "required"}`;
  }
  return `${pathBase}: ${err.message ?? "invalid"}`;
}

function getValidator(): AjvValidate {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: false,
  });
  const schema = getPinnedClawdbotSchema().schema as Record<string, unknown>;
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

export function validateClawdbotConfig(value: unknown): ClawdbotSchemaValidation {
  const validate = getValidator();
  const ok = Boolean(validate(value));
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map(formatAjvError);
  return { ok: false, errors };
}
