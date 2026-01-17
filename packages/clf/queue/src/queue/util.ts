import { createHash } from "node:crypto";
import { EnvVarNameSchema } from "@clawdlets/core/lib/identifiers";

export function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isSafeEnvVarName(value: string): boolean {
  return EnvVarNameSchema.safeParse(value).success;
}

export function computeBackoffMs(params: { attempt: number; baseMs: number; maxMs: number }): number {
  const a = Math.max(1, Math.floor(params.attempt));
  const base = Math.max(1, Math.floor(params.baseMs));
  const max = Math.max(base, Math.floor(params.maxMs));
  const factor = 2 ** (a - 1);
  return Math.min(max, base * factor);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isSqliteUniqueConstraintError(err: unknown): boolean {
  const code = String((err as any)?.code || "");
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

