import { buildFleetSecretsPlan } from "./fleet-secrets-plan.js";
import { suggestSecretNameForEnvVar } from "./fleet-secrets-plan-helpers.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";
import type { MissingSecretConfig, SecretSource } from "./secrets-plan.js";
import { ClawdletsConfigSchema } from "./clawdlets-config.js";

export type SecretsAutowireScope = "fleet" | "bot";

export type SecretsAutowireEntry = {
  bot: string;
  envVar: string;
  secretName: string;
  scope: SecretsAutowireScope;
  sources: SecretSource[];
};

export type SecretsAutowirePlan = {
  updates: SecretsAutowireEntry[];
  skipped: MissingSecretConfig[];
};

function pickDefaultScope(sources: SecretSource[]): SecretsAutowireScope {
  if (sources.includes("channel")) return "bot";
  if (sources.includes("model") || sources.includes("provider")) return "fleet";
  return "bot";
}

function normalizeEnvVarFilter(list: string[] | undefined): Set<string> | null {
  if (!list || list.length === 0) return null;
  const out = new Set<string>();
  for (const entry of list) {
    const cleaned = String(entry || "").trim();
    if (cleaned) out.add(cleaned);
  }
  return out.size > 0 ? out : null;
}

export function planSecretsAutowire(params: {
  config: ClawdletsConfig;
  hostName: string;
  scope?: SecretsAutowireScope;
  bot?: string;
  onlyEnvVars?: string[];
}): SecretsAutowirePlan {
  const plan = buildFleetSecretsPlan({ config: params.config, hostName: params.hostName });
  const onlyEnvVars = normalizeEnvVarFilter(params.onlyEnvVars);
  const targetBot = params.bot ? String(params.bot).trim() : "";

  const missing = plan.missingSecretConfig || [];
  const updates: SecretsAutowireEntry[] = [];
  const skipped: MissingSecretConfig[] = [];
  const seenFleetEnvVars = new Set<string>();

  for (const entry of missing) {
    if (entry.kind !== "envVar") {
      skipped.push(entry);
      continue;
    }
    if (targetBot && entry.bot !== targetBot) {
      skipped.push(entry);
      continue;
    }
    if (onlyEnvVars && !onlyEnvVars.has(entry.envVar)) {
      skipped.push(entry);
      continue;
    }

    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    const scope = params.scope ?? pickDefaultScope(sources);
    if (scope === "fleet") {
      if (seenFleetEnvVars.has(entry.envVar)) {
        skipped.push(entry);
        continue;
      }
      seenFleetEnvVars.add(entry.envVar);
    }
    const secretName = suggestSecretNameForEnvVar(entry.envVar, scope === "bot" ? entry.bot : undefined);
    updates.push({
      bot: entry.bot,
      envVar: entry.envVar,
      secretName,
      scope,
      sources,
    });
  }

  updates.sort((a, b) => {
    if (a.envVar !== b.envVar) return a.envVar.localeCompare(b.envVar);
    if (a.bot !== b.bot) return a.bot.localeCompare(b.bot);
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.secretName.localeCompare(b.secretName);
  });

  return { updates, skipped };
}

export function applySecretsAutowire(params: {
  config: ClawdletsConfig;
  plan: SecretsAutowirePlan;
}): ClawdletsConfig {
  const next = structuredClone(params.config) as ClawdletsConfig;

  for (const entry of params.plan.updates) {
    if (entry.scope === "fleet") {
      const existing = next.fleet.secretEnv?.[entry.envVar];
      if (existing && existing !== entry.secretName) {
        throw new Error(`conflict for ${entry.envVar}: fleet.secretEnv already set to ${existing}`);
      }
      next.fleet.secretEnv[entry.envVar] = entry.secretName;
      continue;
    }
    const bot = next.fleet.bots[entry.bot];
    if (!bot) throw new Error(`unknown bot: ${entry.bot}`);
    const profile = bot.profile;
    if (!profile.secretEnv) profile.secretEnv = {};
    const existing = profile.secretEnv[entry.envVar];
    if (existing && existing !== entry.secretName) {
      throw new Error(`conflict for ${entry.envVar} on bot ${entry.bot}: profile.secretEnv already set to ${existing}`);
    }
    profile.secretEnv[entry.envVar] = entry.secretName;
  }

  return ClawdletsConfigSchema.parse(next);
}
