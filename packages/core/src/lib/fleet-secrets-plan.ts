import { findEnvVarRefs } from "./env-var-refs.js";
import { getModelRequiredEnvVars } from "./llm-provider-env.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";
import type { SecretFileSpec } from "./secret-wiring.js";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWhatsAppEnabled(clawdbot: any): boolean {
  const whatsapp = clawdbot?.channels?.whatsapp;
  if (!isPlainObject(whatsapp)) return false;
  return (whatsapp as any).enabled !== false;
}

export type MissingFleetSecretConfig =
  | {
      kind: "envVar";
      bot: string;
      envVar: string;
      sources: Array<"config" | "model">;
      paths: string[];
    }
  | {
      kind: "secretFile";
      scope: "host" | "bot";
      bot?: string;
      fileId: string;
      targetPath: string;
      message: string;
    };

export type FleetSecretsPlan = {
  bots: string[];
  hostSecretNamesRequired: string[];

  secretNamesAll: string[];
  secretNamesRequired: string[];

  missingSecretConfig: MissingFleetSecretConfig[];

  byBot: Record<
    string,
    {
      envVarsRequired: string[];
      envVarRefs: ReturnType<typeof findEnvVarRefs>;
      secretEnv: Record<string, string>;
      envVarToSecretName: Record<string, string>;
      secretFiles: Record<string, SecretFileSpec>;
      statefulChannels: string[];
    }
  >;

  hostSecretFiles: Record<string, SecretFileSpec>;
};

function mergeSecretEnv(globalEnv: unknown, botEnv: unknown): Record<string, string> {
  const out: Record<string, string> = {};

  const apply = (v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      if (typeof vv !== "string") continue;
      const key = String(k || "").trim();
      const value = vv.trim();
      if (!key || !value) continue;
      out[key] = value;
    }
  };

  apply(globalEnv);
  apply(botEnv);
  return out;
}

function normalizeSecretFiles(value: unknown): Record<string, SecretFileSpec> {
  if (!isPlainObject(value)) return {};
  return value as Record<string, SecretFileSpec>;
}

export function buildFleetSecretsPlan(params: { config: ClawdletsConfig; hostName: string }): FleetSecretsPlan {
  const hostName = params.hostName.trim();
  const hostCfg = (params.config.hosts as any)?.[hostName];
  if (!hostCfg) throw new Error(`missing host in config.hosts: ${hostName}`);

  const bots = params.config.fleet.botOrder || [];
  const botConfigs = (params.config.fleet.bots || {}) as Record<string, unknown>;

  const hostSecretNamesRequired = new Set<string>(["admin_password_hash"]);

  const tailnetMode = String((hostCfg as any)?.tailnet?.mode || "none");
  if (tailnetMode === "tailscale") hostSecretNamesRequired.add("tailscale_auth_key");

  const garnixPrivate = (hostCfg as any)?.cache?.garnix?.private;
  if (garnixPrivate?.enable) {
    const secretName = String(garnixPrivate?.netrcSecret || "garnix_netrc").trim();
    if (secretName) hostSecretNamesRequired.add(secretName);
  }

  const resticEnabled = Boolean((params.config.fleet.backups as any)?.restic?.enable);
  if (resticEnabled) hostSecretNamesRequired.add("restic_password");

  const secretNamesAll = new Set<string>();
  const secretNamesRequired = new Set<string>();
  const missingSecretConfig: MissingFleetSecretConfig[] = [];

  const byBot: FleetSecretsPlan["byBot"] = {};

  const hostSecretFiles = normalizeSecretFiles((params.config.fleet as any)?.secretFiles);
  for (const [fileId, spec] of Object.entries(hostSecretFiles)) {
    if (!spec?.secretName) continue;
    secretNamesAll.add(spec.secretName);
    secretNamesRequired.add(spec.secretName);
    if (!String(spec.targetPath || "").startsWith("/var/lib/clawdlets/")) {
      missingSecretConfig.push({
        kind: "secretFile",
        scope: "host",
        fileId,
        targetPath: String(spec.targetPath || ""),
        message: "fleet.secretFiles targetPath must be under /var/lib/clawdlets/",
      });
    }
  }

  const fleetSecretEnv = (params.config.fleet as any)?.secretEnv;

  for (const bot of bots) {
    const botCfg = (botConfigs as any)?.[bot] || {};
    const profile = (botCfg as any)?.profile || {};
    const clawdbot = (botCfg as any)?.clawdbot || {};

    const secretEnv = mergeSecretEnv(fleetSecretEnv, profile?.secretEnv);
    for (const secretName of Object.values(secretEnv)) secretNamesAll.add(secretName);

    const envVarRefs = findEnvVarRefs(clawdbot);
    const requiredEnvBySource = new Map<string, Set<"config" | "model">>();
    const addRequiredEnv = (envVar: string, source: "config" | "model") => {
      const key = envVar.trim();
      if (!key) return;
      const set = requiredEnvBySource.get(key) ?? new Set();
      set.add(source);
      requiredEnvBySource.set(key, set);
    };

    for (const envVar of envVarRefs.vars) addRequiredEnv(envVar, "config");

    const models = collectBotModels({ clawdbot, hostDefaultModel: String(hostCfg.agentModelPrimary || "") });
    for (const model of models) {
      for (const envVar of getModelRequiredEnvVars(model)) addRequiredEnv(envVar, "model");
    }

    const envVarsRequired = Array.from(requiredEnvBySource.keys()).sort();
    const envVarToSecretName: Record<string, string> = {};
    for (const envVar of envVarsRequired) {
      const secretName = String(secretEnv[envVar] || "").trim();
      if (!secretName) {
        missingSecretConfig.push({
          kind: "envVar",
          bot,
          envVar,
          sources: Array.from(requiredEnvBySource.get(envVar) ?? new Set<"config" | "model">()).sort(),
          paths: envVarRefs.pathsByVar[envVar] || [],
        });
        continue;
      }
      envVarToSecretName[envVar] = secretName;
      secretNamesRequired.add(secretName);
    }

    const botSecretFiles = normalizeSecretFiles(profile?.secretFiles);
    for (const [fileId, spec] of Object.entries(botSecretFiles)) {
      if (!spec?.secretName) continue;
      secretNamesAll.add(spec.secretName);
      secretNamesRequired.add(spec.secretName);
      const expectedPrefix = `/srv/clawdbot/${bot}/`;
      if (!String(spec.targetPath || "").startsWith(expectedPrefix)) {
        missingSecretConfig.push({
          kind: "secretFile",
          scope: "bot",
          bot,
          fileId,
          targetPath: String(spec.targetPath || ""),
          message: `fleet.bots.${bot}.profile.secretFiles targetPath must be under ${expectedPrefix}`,
        });
      }
    }

    const statefulChannels = isWhatsAppEnabled(clawdbot) ? ["whatsapp"] : [];

    byBot[bot] = {
      envVarsRequired,
      envVarRefs,
      secretEnv,
      envVarToSecretName,
      secretFiles: botSecretFiles,
      statefulChannels,
    };
  }

  return {
    bots,
    hostSecretNamesRequired: Array.from(hostSecretNamesRequired).sort(),
    secretNamesAll: Array.from(secretNamesAll).sort(),
    secretNamesRequired: Array.from(secretNamesRequired).sort(),
    missingSecretConfig,
    byBot,
    hostSecretFiles,
  };
}
