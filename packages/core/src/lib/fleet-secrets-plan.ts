import { findEnvVarRefs } from "./env-var-refs.js";
import {
  ENV_VAR_HELP,
  extractEnvVarRef,
  normalizeEnvVarPaths,
  pickPrimarySource,
  recordSecretSpec,
  type SecretSpecAccumulator,
} from "./fleet-secrets-plan-helpers.js";
import { getModelRequiredEnvVars, getProviderRequiredEnvVars } from "./llm-provider-env.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";
import type { SecretFileSpec } from "./secret-wiring.js";
import type { MissingSecretConfig, SecretSource, SecretSpec, SecretsPlanWarning } from "./secrets-plan.js";

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


export type MissingFleetSecretConfig = MissingSecretConfig;

export type FleetSecretsPlan = {
  bots: string[];
  hostSecretNamesRequired: string[];

  secretNamesAll: string[];
  secretNamesRequired: string[];

  required: SecretSpec[];
  optional: SecretSpec[];
  missing: MissingSecretConfig[];
  warnings: SecretsPlanWarning[];

  missingSecretConfig: MissingSecretConfig[];

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

  const secretNamesAll = new Set<string>();
  const secretNamesRequired = new Set<string>();
  const missingSecretConfig: MissingSecretConfig[] = [];
  const warnings: SecretsPlanWarning[] = [];
  const secretSpecs = new Map<string, SecretSpecAccumulator>();
  const secretEnvMetaByName = new Map<string, { envVars: Set<string>; bots: Set<string> }>();

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

  for (const secretName of hostSecretNamesRequired) {
    recordSecretSpec(secretSpecs, {
      name: secretName,
      kind: "extra",
      scope: "host",
      source: "custom",
      optional: false,
    });
  }

  const byBot: FleetSecretsPlan["byBot"] = {};

  const hostSecretFiles = normalizeSecretFiles((params.config.fleet as any)?.secretFiles);
  for (const [fileId, spec] of Object.entries(hostSecretFiles)) {
    if (!spec?.secretName) continue;
    secretNamesAll.add(spec.secretName);
    secretNamesRequired.add(spec.secretName);
    recordSecretSpec(secretSpecs, {
      name: spec.secretName,
      kind: "file",
      scope: "host",
      source: "custom",
      optional: false,
      fileId,
    });
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
  const recordSecretEnvMeta = (secretName: string, envVar: string, bot: string) => {
    if (!secretName) return;
    const existing = secretEnvMetaByName.get(secretName);
    if (!existing) {
      secretEnvMetaByName.set(secretName, {
        envVars: new Set(envVar ? [envVar] : []),
        bots: new Set(bot ? [bot] : []),
      });
      return;
    }
    if (envVar) existing.envVars.add(envVar);
    if (bot) existing.bots.add(bot);
  };

  for (const bot of bots) {
    const botCfg = (botConfigs as any)?.[bot] || {};
    const profile = (botCfg as any)?.profile || {};
    const clawdbot = (botCfg as any)?.clawdbot || {};

    const secretEnv = mergeSecretEnv(fleetSecretEnv, profile?.secretEnv);
    for (const [envVar, secretNameRaw] of Object.entries(secretEnv)) {
      const secretName = String(secretNameRaw || "").trim();
      if (!secretName) continue;
      secretNamesAll.add(secretName);
      recordSecretEnvMeta(secretName, envVar, bot);
    }

    const envVarRefs = findEnvVarRefs(clawdbot);
    const envVarPathsByVar: Record<string, string[]> = { ...envVarRefs.pathsByVar };
    const requiredEnvBySource = new Map<string, Set<SecretSource>>();
    const addRequiredEnv = (envVar: string, source: SecretSource, path?: string) => {
      const key = envVar.trim();
      if (!key) return;
      const set = requiredEnvBySource.get(key) ?? new Set<SecretSource>();
      set.add(source);
      requiredEnvBySource.set(key, set);
      if (path) {
        envVarPathsByVar[key] = envVarPathsByVar[key] || [];
        envVarPathsByVar[key]!.push(path);
      }
    };

    for (const envVar of envVarRefs.vars) addRequiredEnv(envVar, "custom");

    const addChannelToken = (params: { channel: string; envVar: string; path: string; value: unknown }) => {
      if (typeof params.value !== "string") return;
      const trimmed = params.value.trim();
      if (!trimmed) return;
      const envVar = extractEnvVarRef(trimmed);
      if (envVar && envVar !== params.envVar) {
        warnings.push({
          kind: "inlineToken",
          channel: params.channel,
          bot,
          path: params.path,
          message: `Unexpected env ref at ${params.path}: ${trimmed}`,
          suggestion: `Use \${${params.envVar}} for ${params.channel} and map it in fleet.secretEnv or fleet.bots.${bot}.profile.secretEnv.`,
        });
      }
      if (!envVar) {
        warnings.push({
          kind: "inlineToken",
          channel: params.channel,
          bot,
          path: params.path,
          message: `Inline ${params.channel} token detected at ${params.path}`,
          suggestion: `Replace with \${${params.envVar}} and map it in fleet.secretEnv or fleet.bots.${bot}.profile.secretEnv.`,
        });
      }
      addRequiredEnv(params.envVar, "channel", params.path);
    };

    const channels = (clawdbot as any)?.channels;
    if (isPlainObject(channels)) {
      const discord = channels.discord;
      if (isPlainObject(discord) && (discord as any).enabled !== false) {
        addChannelToken({ channel: "discord", envVar: "DISCORD_BOT_TOKEN", path: "channels.discord.token", value: (discord as any).token });
        const accounts = (discord as any).accounts;
        if (isPlainObject(accounts)) {
          for (const [accountId, accountCfg] of Object.entries(accounts)) {
            if (!isPlainObject(accountCfg)) continue;
            addChannelToken({
              channel: "discord",
              envVar: "DISCORD_BOT_TOKEN",
              path: `channels.discord.accounts.${accountId}.token`,
              value: (accountCfg as any).token,
            });
          }
        }
      }

      const telegram = channels.telegram;
      if (isPlainObject(telegram) && (telegram as any).enabled !== false) {
        addChannelToken({ channel: "telegram", envVar: "TELEGRAM_BOT_TOKEN", path: "channels.telegram.botToken", value: (telegram as any).botToken });
        const accounts = (telegram as any).accounts;
        if (isPlainObject(accounts)) {
          for (const [accountId, accountCfg] of Object.entries(accounts)) {
            if (!isPlainObject(accountCfg)) continue;
            addChannelToken({
              channel: "telegram",
              envVar: "TELEGRAM_BOT_TOKEN",
              path: `channels.telegram.accounts.${accountId}.botToken`,
              value: (accountCfg as any).botToken,
            });
          }
        }
      }

      const slack = channels.slack;
      if (isPlainObject(slack) && (slack as any).enabled !== false) {
        addChannelToken({ channel: "slack", envVar: "SLACK_BOT_TOKEN", path: "channels.slack.botToken", value: (slack as any).botToken });
        addChannelToken({ channel: "slack", envVar: "SLACK_APP_TOKEN", path: "channels.slack.appToken", value: (slack as any).appToken });
        const accounts = (slack as any).accounts;
        if (isPlainObject(accounts)) {
          for (const [accountId, accountCfg] of Object.entries(accounts)) {
            if (!isPlainObject(accountCfg)) continue;
            addChannelToken({
              channel: "slack",
              envVar: "SLACK_BOT_TOKEN",
              path: `channels.slack.accounts.${accountId}.botToken`,
              value: (accountCfg as any).botToken,
            });
            addChannelToken({
              channel: "slack",
              envVar: "SLACK_APP_TOKEN",
              path: `channels.slack.accounts.${accountId}.appToken`,
              value: (accountCfg as any).appToken,
            });
          }
        }
      }
    }

    const models = collectBotModels({ clawdbot, hostDefaultModel: String(hostCfg.agentModelPrimary || "") });
    for (const model of models) {
      for (const envVar of getModelRequiredEnvVars(model)) addRequiredEnv(envVar, "model");
    }

    const providers = (clawdbot as any)?.models?.providers;
    if (isPlainObject(providers)) {
      for (const [providerIdRaw, providerCfg] of Object.entries(providers)) {
        const providerId = String(providerIdRaw || "").trim();
        if (!providerId) continue;
        for (const envVar of getProviderRequiredEnvVars(providerId)) {
          addRequiredEnv(envVar, "provider", `models.providers.${providerId}.apiKey`);
        }
        if (!isPlainObject(providerCfg)) continue;
        const apiKey = (providerCfg as any).apiKey;
        if (typeof apiKey === "string") {
          const envVar = extractEnvVarRef(apiKey);
          if (envVar) {
            addRequiredEnv(envVar, "provider", `models.providers.${providerId}.apiKey`);
          } else if (apiKey.trim()) {
            const known = getProviderRequiredEnvVars(providerId);
            const suggested = known.length === 1 ? `\${${known[0]}}` : "\${PROVIDER_API_KEY}";
            warnings.push({
              kind: "inlineApiKey",
              path: `models.providers.${providerId}.apiKey`,
              bot,
              message: `Inline API key detected at models.providers.${providerId}.apiKey`,
              suggestion: `Replace with ${suggested} and wire it in fleet.secretEnv or fleet.bots.${bot}.profile.secretEnv.`,
            });
          }
        }
      }
    }

    const whatsappEnabled = isWhatsAppEnabled(clawdbot);
    if (whatsappEnabled) {
      warnings.push({
        kind: "statefulChannel",
        channel: "whatsapp",
        bot,
        message: "WhatsApp enabled; requires stateful login on the gateway host.",
      });
    }

    normalizeEnvVarPaths(envVarPathsByVar);

    const envVarsRequired = Array.from(requiredEnvBySource.keys()).sort();
    const envVarToSecretName: Record<string, string> = {};
    for (const envVar of envVarsRequired) {
      const secretName = String(secretEnv[envVar] || "").trim();
      const sources = requiredEnvBySource.get(envVar) ?? new Set<SecretSource>();
      if (!secretName) {
        missingSecretConfig.push({
          kind: "envVar",
          bot,
          envVar,
          sources: Array.from(sources).sort(),
          paths: envVarPathsByVar[envVar] || [],
        });
        continue;
      }
      envVarToSecretName[envVar] = secretName;
      secretNamesRequired.add(secretName);
      recordSecretSpec(secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "bot",
        source: pickPrimarySource(sources),
        optional: false,
        envVar,
        bot,
        help: ENV_VAR_HELP[envVar],
      });
    }

    const botSecretFiles = normalizeSecretFiles(profile?.secretFiles);
    for (const [fileId, spec] of Object.entries(botSecretFiles)) {
      if (!spec?.secretName) continue;
      secretNamesAll.add(spec.secretName);
      secretNamesRequired.add(spec.secretName);
      recordSecretSpec(secretSpecs, {
        name: spec.secretName,
        kind: "file",
        scope: "bot",
        source: "custom",
        optional: false,
        bot,
        fileId,
      });
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

    const statefulChannels = whatsappEnabled ? ["whatsapp"] : [];

    byBot[bot] = {
      envVarsRequired,
      envVarRefs,
      secretEnv,
      envVarToSecretName,
      secretFiles: botSecretFiles,
      statefulChannels,
    };
  }

  for (const secretName of secretNamesAll) {
    if (secretNamesRequired.has(secretName)) continue;
    const meta = secretEnvMetaByName.get(secretName);
    if (!meta) {
      recordSecretSpec(secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "bot",
        source: "custom",
        optional: true,
      });
      continue;
    }
    for (const envVar of meta.envVars) {
      recordSecretSpec(secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "bot",
        source: "custom",
        optional: true,
        envVar,
        help: ENV_VAR_HELP[envVar],
      });
    }
    for (const botId of meta.bots) {
      recordSecretSpec(secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "bot",
        source: "custom",
        optional: true,
        bot: botId,
      });
    }
  }

  const specList: SecretSpec[] = Array.from(secretSpecs.values()).map((spec) => {
    const envVars = Array.from(spec.envVars).sort();
    const bots = Array.from(spec.bots).sort();
    return {
      name: spec.name,
      kind: spec.kind,
      scope: spec.scope,
      source: pickPrimarySource(spec.sources),
      optional: spec.optional || undefined,
      help: spec.help,
      envVars: envVars.length ? envVars : undefined,
      bots: bots.length ? bots : undefined,
      fileId: spec.fileId,
    };
  });

  const byName = (a: SecretSpec, b: SecretSpec) => a.name.localeCompare(b.name);
  const required = specList.filter((spec) => !spec.optional).sort(byName);
  const optional = specList.filter((spec) => spec.optional).sort(byName);

  return {
    bots,
    hostSecretNamesRequired: Array.from(hostSecretNamesRequired).sort(),
    secretNamesAll: Array.from(secretNamesAll).sort(),
    secretNamesRequired: Array.from(secretNamesRequired).sort(),
    required,
    optional,
    missing: missingSecretConfig,
    warnings,
    missingSecretConfig,
    byBot,
    hostSecretFiles,
  };
}
