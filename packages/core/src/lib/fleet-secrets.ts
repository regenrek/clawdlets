import { getLlmProviderFromModelId, getLlmProviderInfo } from "./llm-provider-env.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";

function readStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
    if (typeof vv !== "string") continue;
    const key = String(k || "").trim().toLowerCase();
    const value = vv.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function collectBotModels(params: { clawdbot: any; hostDefaultModel: string }): string[] {
  const models: string[] = [];

  const hostDefaultModel = String(params.hostDefaultModel || "").trim();
  const defaults = params.clawdbot?.agents?.defaults;

  const pushModel = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s) models.push(s);
  };

  const readModelSpec = (spec: unknown) => {
    if (typeof spec === "string") {
      pushModel(spec);
      return;
    }
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return;
    pushModel((spec as any).primary);
    const fallbacks = (spec as any).fallbacks;
    if (Array.isArray(fallbacks)) {
      for (const f of fallbacks) pushModel(f);
    }
  };

  readModelSpec(defaults?.model);
  readModelSpec(defaults?.imageModel);

  if (models.length === 0 && hostDefaultModel) models.push(hostDefaultModel);

  return Array.from(new Set(models));
}

function isDiscordEnabled(clawdbot: any): boolean {
  const discord = clawdbot?.channels?.discord;
  if (!discord || typeof discord !== "object" || Array.isArray(discord)) return false;
  return discord.enabled !== false;
}

export type MissingFleetSecretConfig =
  | { kind: "discord"; bot: string }
  | { kind: "model"; bot: string; provider: string; model: string };

export type FleetSecretsPlan = {
  bots: string[];
  secretNamesAll: string[];
  secretNamesRequired: string[];
  missingSecretConfig: MissingFleetSecretConfig[];
  discordSecretsByBot: Record<string, string>;
  modelSecretsByBot: Record<string, Record<string, string>>;
};

export function buildFleetSecretsPlan(params: { config: ClawdletsConfig; hostName: string }): FleetSecretsPlan {
  const hostName = params.hostName.trim();
  const hostCfg = (params.config.hosts as any)?.[hostName];
  if (!hostCfg) throw new Error(`missing host in config.hosts: ${hostName}`);

  const bots = params.config.fleet.botOrder || [];
  const fleetModelSecrets = readStringRecord(params.config.fleet.modelSecrets || {});
  const botConfigs = (params.config.fleet.bots || {}) as Record<string, unknown>;

  const secretNamesAll = new Set<string>();
  const secretNamesRequired = new Set<string>();
  const missingSecretConfig: MissingFleetSecretConfig[] = [];
  const discordSecretsByBot: Record<string, string> = {};
  const modelSecretsByBot: Record<string, Record<string, string>> = {};

  for (const bot of bots) {
    const botCfg = (botConfigs as any)?.[bot] || {};
    const profile = (botCfg as any)?.profile || {};
    const botModelSecrets = readStringRecord((profile as any)?.modelSecrets);
    const effectiveModelSecrets = { ...fleetModelSecrets, ...botModelSecrets };
    modelSecretsByBot[bot] = effectiveModelSecrets;

    for (const secretName of Object.values(effectiveModelSecrets)) {
      if (secretName) secretNamesAll.add(secretName);
    }

    const discordSecret = String((profile as any)?.discordTokenSecret || "").trim();
    if (discordSecret) {
      secretNamesAll.add(discordSecret);
      discordSecretsByBot[bot] = discordSecret;
    }

    const models = collectBotModels({ clawdbot: (botCfg as any)?.clawdbot || {}, hostDefaultModel: hostCfg.agentModelPrimary });
    const providers = new Set<string>();
    for (const model of models) {
      const provider = getLlmProviderFromModelId(model);
      if (provider) providers.add(provider);
    }

    if (isDiscordEnabled((botCfg as any)?.clawdbot || {})) {
      if (!discordSecret) missingSecretConfig.push({ kind: "discord", bot });
      else secretNamesRequired.add(discordSecret);
    }

    for (const provider of Array.from(providers).sort()) {
      const providerInfo = getLlmProviderInfo(provider);
      const requiresSecret = providerInfo ? providerInfo.secretEnvVars.length > 0 : true;
      if (!requiresSecret) continue;
      const secretName = effectiveModelSecrets[provider] || "";
      if (!secretName) {
        const model = models.find((m) => getLlmProviderFromModelId(m) === provider) || "";
        missingSecretConfig.push({ kind: "model", bot, provider, model });
        continue;
      }
      secretNamesRequired.add(secretName);
    }
  }

  return {
    bots,
    secretNamesAll: Array.from(secretNamesAll).sort(),
    secretNamesRequired: Array.from(secretNamesRequired).sort(),
    missingSecretConfig,
    discordSecretsByBot,
    modelSecretsByBot,
  };
}
