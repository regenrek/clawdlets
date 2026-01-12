import { getModelRequiredEnvVars } from "./llm-provider-env.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";

function readStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
    if (typeof vv !== "string") continue;
    const key = String(k || "").trim();
    const value = vv.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function collectBotModels(params: { botOverride: any; hostDefaultModel: string }): string[] {
  const models: string[] = [];

  const hostDefaultModel = String(params.hostDefaultModel || "").trim();
  const primaryOverride = params.botOverride?.passthrough?.agents?.defaults?.modelPrimary;
  if (typeof primaryOverride === "string" && primaryOverride.trim()) models.push(primaryOverride.trim());
  else if (hostDefaultModel) models.push(hostDefaultModel);

  const extras = params.botOverride?.passthrough?.agents?.models;
  if (extras && typeof extras === "object" && !Array.isArray(extras)) {
    for (const v of Object.values(extras as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (s) models.push(s);
    }
  }

  return Array.from(new Set(models));
}

export type EnvSecretMappingMissing = {
  bot: string;
  envVar: string;
  model: string;
};

export type FleetEnvSecretsPlan = {
  bots: string[];
  envSecretsByBot: Record<string, Record<string, string>>;
  secretNamesAll: string[];
  secretNamesRequired: string[];
  envVarsBySecretName: Record<string, string[]>;
  missingEnvSecretMappings: EnvSecretMappingMissing[];
};

export function buildFleetEnvSecretsPlan(params: { config: ClawdletsConfig; hostName: string }): FleetEnvSecretsPlan {
  const hostName = params.hostName.trim();
  const hostCfg = (params.config.hosts as any)?.[hostName];
  if (!hostCfg) throw new Error(`missing host in config.hosts: ${hostName}`);

  const bots = params.config.fleet.bots || [];
  const fleetEnvSecrets = params.config.fleet.envSecrets || {};
  const botOverrides = (params.config.fleet.botOverrides || {}) as Record<string, unknown>;

  const envSecretsByBot: Record<string, Record<string, string>> = {};
  const secretNamesAll = new Set<string>();
  const secretNamesRequired = new Set<string>();
  const envVarsBySecretName = new Map<string, Set<string>>();
  const missingEnvSecretMappings: EnvSecretMappingMissing[] = [];

  for (const bot of bots) {
    const override = (botOverrides as any)?.[bot] || {};
    const overrideEnvSecrets = readStringRecord((override as any)?.envSecrets);
    const botEnvSecrets = { ...fleetEnvSecrets, ...overrideEnvSecrets } as Record<string, string>;
    envSecretsByBot[bot] = botEnvSecrets;

    for (const [envVar, secretName] of Object.entries(botEnvSecrets)) {
      secretNamesAll.add(secretName);
      const set = envVarsBySecretName.get(secretName) || new Set<string>();
      set.add(envVar);
      envVarsBySecretName.set(secretName, set);
    }

    const models = collectBotModels({ botOverride: override, hostDefaultModel: hostCfg.agentModelPrimary });
    const requiredEnvVars = new Set<string>();
    for (const model of models) {
      for (const envVar of getModelRequiredEnvVars(model)) requiredEnvVars.add(envVar);
    }

    for (const envVar of Array.from(requiredEnvVars).sort()) {
      const secretName = botEnvSecrets[envVar];
      if (!secretName) {
        missingEnvSecretMappings.push({ bot, envVar, model: models[0] || String(hostCfg.agentModelPrimary || "").trim() });
        continue;
      }
      secretNamesRequired.add(secretName);
    }
  }

  const envVarsBySecretNameObj: Record<string, string[]> = {};
  for (const [secretName, vars] of envVarsBySecretName.entries()) {
    envVarsBySecretNameObj[secretName] = Array.from(vars).sort();
  }

  return {
    bots,
    envSecretsByBot,
    secretNamesAll: Array.from(secretNamesAll).sort(),
    secretNamesRequired: Array.from(secretNamesRequired).sort(),
    envVarsBySecretName: envVarsBySecretNameObj,
    missingEnvSecretMappings,
  };
}

