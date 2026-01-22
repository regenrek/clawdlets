import { z } from "zod";

const SAFE_HOSTNAME_RE = /^[a-z][a-z0-9-]*$/;
const SAFE_BOT_ID_RE = /^[a-z][a-z0-9_-]*$/;
const SAFE_PERSONA_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const SAFE_SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SAFE_OPERATOR_ID_RE = /^[a-zA-Z0-9._-]+$/;
const SAFE_ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export const HostNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_HOSTNAME_RE.test(v), { message: "invalid host name (use [a-z][a-z0-9-]*)" });

export const BotIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_BOT_ID_RE.test(v), { message: "invalid bot id (use [a-z][a-z0-9_-]*)" });

export const PersonaNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_PERSONA_NAME_RE.test(v), { message: "invalid persona name (use [a-z][a-z0-9_-]*)" });

export const SecretNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_SECRET_NAME_RE.test(v), { message: "invalid secret name (use [A-Za-z][A-Za-z0-9_-]*)" });

export const EnvVarNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_ENV_VAR_NAME_RE.test(v), { message: "invalid env var name (use [A-Z_][A-Z0-9_]*)" });

export const OperatorIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_OPERATOR_ID_RE.test(v), { message: "invalid operator id (use [a-zA-Z0-9._-]+)" })
  .refine((v) => v !== "." && v !== "..", { message: "invalid operator id" });

export function assertSafeHostName(hostName: string): void {
  void HostNameSchema.parse(hostName);
}

export function assertSafeSecretName(secretName: string): void {
  void SecretNameSchema.parse(secretName);
}

export function assertSafePersonaName(personaName: string): void {
  void PersonaNameSchema.parse(personaName);
}

export function assertSafeOperatorId(operatorId: string): void {
  void OperatorIdSchema.parse(operatorId);
}

export function sanitizeOperatorId(raw: string): string {
  const cleaned =
    String(raw || "operator")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_") || "operator";
  if (cleaned === "." || cleaned === "..") return "operator";
  return cleaned;
}
