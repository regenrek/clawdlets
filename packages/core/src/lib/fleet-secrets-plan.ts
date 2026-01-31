import { findEnvVarRefs } from "./env-var-refs.js";
import {
  applyChannelEnvRequirements,
  applyHookEnvRequirements,
  applySkillEnvRequirements,
  ENV_VAR_HELP,
  buildBaseSecretEnv,
  buildDerivedSecretEnv,
  buildEnvVarAliasMap,
  canonicalizeEnvVar,
  collectBotModels,
  collectDerivedSecretEnvEntries,
  extractEnvVarRef,
  isPlainObject,
  isWhatsAppEnabled,
  normalizeSecretFiles,
  normalizeEnvVarPaths,
  pickPrimarySource,
  recordSecretSpec,
  type SecretSpecAccumulator,
} from "./fleet-secrets-plan-helpers.js";
import {
  getLlmProviderFromModelId,
  getProviderAuthMode,
  getProviderCredentials,
} from "@clawdlets/shared/lib/llm-provider-env";
import type { ClawdletsConfig } from "./clawdlets-config.js";
import type { SecretFileSpec } from "./secret-wiring.js";
import type { MissingSecretConfig, SecretSource, SecretSpec, SecretsPlanWarning } from "./secrets-plan.js";

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

const isUnsafeTargetPath = (targetPath: string) =>
  targetPath.includes("/../") || targetPath.endsWith("/..") || targetPath.includes("\u0000");

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
  const envVarHelpOverrides = new Map<string, string>();

  const hostSecretNamesRequired = new Set<string>(["admin_password_hash"]);

  const tailnetMode = String((hostCfg as any)?.tailnet?.mode || "none");
  if (tailnetMode === "tailscale") hostSecretNamesRequired.add("tailscale_auth_key");

  const cacheNetrc = (hostCfg as any)?.cache?.netrc;
  if (cacheNetrc?.enable) {
    const secretName = String(cacheNetrc?.secretName || "garnix_netrc").trim();
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
    const targetPath = String(spec.targetPath || "");
    if (isUnsafeTargetPath(targetPath)) {
      missingSecretConfig.push({
        kind: "secretFile",
        scope: "host",
        fileId,
        targetPath,
        message: "fleet.secretFiles targetPath must not contain /../, end with /.., or include NUL",
      });
      continue;
    }
    if (!targetPath.startsWith("/var/lib/clawdlets/")) {
      missingSecretConfig.push({
        kind: "secretFile",
        scope: "host",
        fileId,
        targetPath,
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

  const envVarAliasMap = buildEnvVarAliasMap();

  for (const bot of bots) {
    const botCfg = (botConfigs as any)?.[bot] || {};
    const profile = (botCfg as any)?.profile || {};
    const clawdbot = (botCfg as any)?.clawdbot || {};

    const baseSecretEnv = buildBaseSecretEnv({
      globalEnv: fleetSecretEnv,
      botEnv: profile?.secretEnv,
      aliasMap: envVarAliasMap,
      warnings,
      bot,
    });
    const derivedEntries = collectDerivedSecretEnvEntries(profile);
    const derivedSecretEnv = buildDerivedSecretEnv(profile);
    const secretEnv = { ...baseSecretEnv, ...derivedSecretEnv };
    const derivedDupes = derivedEntries
      .map((entry) => entry.envVar)
      .filter((envVar) => Object.prototype.hasOwnProperty.call(baseSecretEnv, envVar));
    for (const entry of derivedEntries) {
      if (entry.help && !envVarHelpOverrides.has(entry.envVar)) {
        envVarHelpOverrides.set(entry.envVar, entry.help);
      }
    }
    if (derivedDupes.length > 0) {
      warnings.push({
        kind: "config",
        bot,
        message: `secretEnv conflicts with derived hooks/skill env vars: ${derivedDupes.join(",")}`,
      });
    }
    for (const [envVar, secretNameRaw] of Object.entries(secretEnv)) {
      const secretName = String(secretNameRaw || "").trim();
      if (!secretName) continue;
      secretNamesAll.add(secretName);
      recordSecretEnvMeta(secretName, envVar, bot);
    }

    const envVarRefsRaw = findEnvVarRefs(clawdbot);
    const envVarPathsByVar: Record<string, string[]> = {};
    for (const [envVar, paths] of Object.entries(envVarRefsRaw.pathsByVar)) {
      const canonical = canonicalizeEnvVar(envVar, envVarAliasMap);
      if (!canonical) continue;
      envVarPathsByVar[canonical] = (envVarPathsByVar[canonical] || []).concat(paths);
    }
    const envVarRefs = {
      vars: Object.keys(envVarPathsByVar).sort(),
      pathsByVar: envVarPathsByVar,
    };
    const requiredEnvBySource = new Map<string, Set<SecretSource>>();
    const addRequiredEnv = (envVar: string, source: SecretSource, path?: string) => {
      const key = canonicalizeEnvVar(envVar, envVarAliasMap);
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
    for (const entry of derivedEntries) addRequiredEnv(entry.envVar, "custom", entry.path);

    applyChannelEnvRequirements({ bot, clawdbot, warnings, addRequiredEnv });
    applyHookEnvRequirements({ bot, clawdbot, warnings, addRequiredEnv });
    applySkillEnvRequirements({ bot, clawdbot, warnings, addRequiredEnv, envVarHelpOverrides });

    const models = collectBotModels({ clawdbot, hostDefaultModel: String(hostCfg.agentModelPrimary || "") });
    const providersFromModels = new Set<string>();
    for (const model of models) {
      const provider = getLlmProviderFromModelId(model);
      if (provider) providersFromModels.add(provider);
    }

    const providersFromConfig = new Set<string>();
    const providers = (clawdbot as any)?.models?.providers;
    if (isPlainObject(providers)) {
      for (const [providerIdRaw, providerCfg] of Object.entries(providers)) {
        const providerId = String(providerIdRaw || "").trim();
        if (!providerId) continue;
        providersFromConfig.add(providerId);
        if (!isPlainObject(providerCfg)) continue;
        const apiKey = (providerCfg as any).apiKey;
        if (typeof apiKey === "string") {
          const envVar = extractEnvVarRef(apiKey);
          if (envVar) {
            addRequiredEnv(envVar, "provider", `models.providers.${providerId}.apiKey`);
          } else if (apiKey.trim()) {
            const known = getProviderCredentials(providerId)
              .map((slot) => slot.anyOfEnv[0])
              .filter(Boolean);
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

    const usedProviders = new Set<string>([...providersFromModels, ...providersFromConfig]);
    const hasMappingForAnyOf = (anyOfEnv: string[]): boolean => {
      for (const envVar of anyOfEnv) {
        const canonical = canonicalizeEnvVar(envVar, envVarAliasMap);
        if (!canonical) continue;
        if (secretEnv[canonical]) return true;
      }
      return false;
    };

    for (const provider of usedProviders) {
      const auth = getProviderAuthMode(provider);
      const credentials = getProviderCredentials(provider);
      const sourcesForProvider: SecretSource[] = [];
      if (providersFromModels.has(provider)) sourcesForProvider.push("model");
      if (providersFromConfig.has(provider)) sourcesForProvider.push("provider");
      if (credentials.length === 0) {
        if (auth === "oauth") {
          warnings.push({
            kind: "auth",
            provider,
            bot,
            message: `Provider ${provider} requires OAuth login (no env vars required).`,
          });
        }
        continue;
      }

      let hasAnyMapping = false;
      for (const slot of credentials) {
        if (slot.anyOfEnv.length === 0) continue;
        const canonical = slot.anyOfEnv[0]!;
        const mapped = hasMappingForAnyOf(slot.anyOfEnv);
        if (mapped) {
          hasAnyMapping = true;
        }
        if (auth === "apiKey") {
          for (const source of sourcesForProvider) addRequiredEnv(canonical, source);
        } else if (auth === "mixed" && mapped) {
          for (const source of sourcesForProvider) addRequiredEnv(canonical, source);
        }
      }

      if ((auth === "oauth" || auth === "mixed") && !hasAnyMapping) {
        warnings.push({
          kind: "auth",
          provider,
          bot,
          message: auth === "mixed"
            ? `Provider ${provider} supports OAuth or API key; no env wiring found (manual login required).`
            : `Provider ${provider} requires OAuth login (no env wiring found).`,
        });
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
      const help = envVarHelpOverrides.get(envVar) ?? ENV_VAR_HELP[envVar];
      recordSecretSpec(secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "bot",
        source: pickPrimarySource(sources),
        optional: false,
        envVar,
        bot,
        help,
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
      const expectedPrefix = `/var/lib/clawdlets/secrets/bots/${bot}/`;
      const targetPath = String(spec.targetPath || "");
      if (isUnsafeTargetPath(targetPath)) {
        missingSecretConfig.push({
          kind: "secretFile",
          scope: "bot",
          bot,
          fileId,
          targetPath,
          message: `fleet.bots.${bot}.profile.secretFiles targetPath must not contain /../, end with /.., or include NUL`,
        });
        continue;
      }
      if (!targetPath.startsWith(expectedPrefix)) {
        missingSecretConfig.push({
          kind: "secretFile",
          scope: "bot",
          bot,
          fileId,
          targetPath,
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
      const help = envVarHelpOverrides.get(envVar) ?? ENV_VAR_HELP[envVar];
      recordSecretSpec(secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "bot",
        source: "custom",
        optional: true,
        envVar,
        help,
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
