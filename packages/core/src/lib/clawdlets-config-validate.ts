import type { ClawdletsConfig } from "./clawdlets-config.js";
import { buildClawdbotBotConfig, type ClawdbotInvariantWarning } from "./clawdbot-config-invariants.js";
import { validateClawdbotConfig } from "./clawdbot-schema-validate.js";
import { buildFleetSecretsPlan } from "./fleet-secrets-plan.js";
import { buildBaseSecretEnv, buildDerivedSecretEnv, buildEnvVarAliasMap, canonicalizeEnvVar } from "./fleet-secrets-plan-helpers.js";
import { EnvVarNameSchema } from "@clawdlets/shared/lib/identifiers";
import type { MissingSecretConfig, SecretsPlanWarning } from "./secrets-plan.js";

export type ClawdletsConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  missing: MissingSecretConfig[];
  inlineWarnings: SecretsPlanWarning[];
  authWarnings: SecretsPlanWarning[];
  invariantWarnings: ClawdbotInvariantWarning[];
  schemaErrors: Record<string, string[]>;
};

function formatMissing(missing: MissingSecretConfig): string {
  if (missing.kind === "envVar") {
    return `missing secretEnv mapping bot=${missing.bot} envVar=${missing.envVar}`;
  }
  return `invalid secret file config scope=${missing.scope} id=${missing.fileId} targetPath=${missing.targetPath}`;
}

function formatInvariantWarning(w: ClawdbotInvariantWarning): string {
  return `bot=${w.bot} ${w.message} (${w.path})`;
}

function formatSchemaError(bot: string, message: string): string {
  return `bot=${bot} schema: ${message}`;
}

function formatPlanWarning(w: SecretsPlanWarning): string {
  const bot = w.bot ? `bot=${w.bot} ` : "";
  const path = w.path ? ` path=${w.path}` : "";
  return `${bot}${w.message}${path}`;
}

export function validateClawdletsConfig(params: {
  config: ClawdletsConfig;
  hostName: string;
  strict?: boolean;
}): ClawdletsConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schemaErrors: Record<string, string[]> = {};
  const invariantWarnings: ClawdbotInvariantWarning[] = [];

  for (const bot of params.config.fleet.botOrder || []) {
    const res = buildClawdbotBotConfig({ config: params.config, bot });
    if (res.warnings.length > 0) invariantWarnings.push(...res.warnings);
    const validation = validateClawdbotConfig(res.merged);
    if (!validation.ok) {
      schemaErrors[bot] = validation.errors;
      for (const err of validation.errors) errors.push(formatSchemaError(bot, err));
    }
  }

  const secretsPlan = buildFleetSecretsPlan({ config: params.config, hostName: params.hostName });
  const missing = secretsPlan.missingSecretConfig || [];
  for (const m of missing) errors.push(formatMissing(m));

  const envVarAliasMap = buildEnvVarAliasMap();
  const botOrder = params.config.fleet.botOrder || [];
  for (const bot of botOrder) {
    const botCfg = (params.config.fleet.bots as any)?.[bot] || {};
    const profile = (botCfg as any)?.profile || {};
    const baseSecretEnv = buildBaseSecretEnv({
      globalEnv: (params.config.fleet as any)?.secretEnv,
      botEnv: profile?.secretEnv,
      aliasMap: envVarAliasMap,
      warnings: [],
      bot,
    });
    const derivedSecretEnv = buildDerivedSecretEnv(profile);
    const derivedDupes = Object.keys(derivedSecretEnv).filter((envVar) =>
      Object.prototype.hasOwnProperty.call(baseSecretEnv, envVar),
    );
    if (derivedDupes.length > 0) {
      errors.push(`bot=${bot} secretEnv conflicts with derived hooks/skill env vars: ${derivedDupes.join(",")}`);
    }

    const allowlistRaw = (profile as any)?.secretEnvAllowlist;
    if (allowlistRaw !== null && allowlistRaw !== undefined) {
      if (!Array.isArray(allowlistRaw)) {
        errors.push(`bot=${bot} secretEnvAllowlist must be a list of env var names`);
        continue;
      }
      const allowlist = new Set<string>();
      const invalid: string[] = [];
      for (const entry of allowlistRaw) {
        if (typeof entry !== "string") {
          invalid.push(String(entry ?? ""));
          continue;
        }
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const canonical = canonicalizeEnvVar(trimmed, envVarAliasMap);
        if (!canonical) {
          invalid.push(trimmed);
          continue;
        }
        const parsed = EnvVarNameSchema.safeParse(canonical);
        if (!parsed.success) {
          invalid.push(trimmed);
          continue;
        }
        allowlist.add(canonical);
      }
      if (invalid.length > 0) {
        errors.push(`bot=${bot} secretEnvAllowlist contains invalid env var(s): ${invalid.slice(0, 6).join(",")}`);
        continue;
      }

      const expected = secretsPlan.byBot?.[bot]?.envVarsRequired || [];
      const expectedSet = new Set(expected);
      const missingRequired = expected.filter((envVar) => !allowlist.has(envVar));
      const unused = Array.from(allowlist).filter((envVar) => !expectedSet.has(envVar));
      if (missingRequired.length > 0) {
        const msg = `bot=${bot} secretEnvAllowlist missing required env vars: ${missingRequired.join(",")}`;
        warnings.push(msg);
        if (params.strict) errors.push(msg);
      }
      if (unused.length > 0) {
        const msg = `bot=${bot} secretEnvAllowlist contains unused env vars: ${unused.join(",")}`;
        warnings.push(msg);
        if (params.strict) errors.push(msg);
      }
    }
  }

  const inlineWarnings = (secretsPlan.warnings || []).filter((w) => w.kind === "inlineToken" || w.kind === "inlineApiKey");
  const authWarnings = (secretsPlan.warnings || []).filter((w) => w.kind === "auth");
  const configWarnings = (secretsPlan.warnings || []).filter(
    (w) => w.kind !== "inlineToken" && w.kind !== "inlineApiKey" && w.kind !== "auth",
  );

  for (const w of configWarnings) warnings.push(formatPlanWarning(w));
  for (const w of authWarnings) warnings.push(formatPlanWarning(w));
  for (const w of inlineWarnings) warnings.push(formatPlanWarning(w));
  for (const w of invariantWarnings) warnings.push(formatInvariantWarning(w));

  if (params.strict) {
    for (const w of inlineWarnings) errors.push(formatPlanWarning(w));
    for (const w of invariantWarnings) errors.push(formatInvariantWarning(w));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    missing,
    inlineWarnings,
    authWarnings,
    invariantWarnings,
    schemaErrors,
  };
}
