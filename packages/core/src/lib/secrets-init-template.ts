import type { ClawdletsConfig } from "./clawdlets-config.js";
import type { FleetSecretsPlan } from "./fleet-secrets-plan.js";

type SecretsInitTemplateSets = {
  requiresTailscaleAuthKey: boolean;
  requiredSecrets: string[];
  optionalSecrets: string[];
  templateSecrets: Record<string, string>;
  requiredSecretNames: string[];
  garnixNetrcSecretName: string;
};

const SKIP_HOST_SECRET_NAMES = new Set(["admin_password_hash", "tailscale_auth_key"]);

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function buildSecretsInitTemplateSets(params: {
  secretsPlan: FleetSecretsPlan;
  hostCfg: ClawdletsConfig["hosts"][string];
}): SecretsInitTemplateSets {
  const hostCfg = params.hostCfg;
  const secretsPlan = params.secretsPlan;

  const hostRequiredSecretNames = new Set<string>(secretsPlan.hostSecretNamesRequired);
  const requiresTailscaleAuthKey = hostRequiredSecretNames.has("tailscale_auth_key");

  const garnixPrivate = hostCfg.cache?.garnix?.private;
  const garnixPrivateEnabled = Boolean(garnixPrivate?.enable);
  const garnixNetrcSecretName = garnixPrivateEnabled ? String(garnixPrivate?.netrcSecret || "garnix_netrc").trim() : "";
  if (garnixPrivateEnabled && !garnixNetrcSecretName) {
    throw new Error("cache.garnix.private.netrcSecret must be set when private cache is enabled");
  }

  const requiredSecrets = uniqSorted(
    (secretsPlan.required || []).map((spec) => spec.name).filter((name) => !SKIP_HOST_SECRET_NAMES.has(name)),
  );
  const requiredSecretsSet = new Set(requiredSecrets);
  const optionalSecrets = uniqSorted(
    (secretsPlan.optional || []).map((spec) => spec.name).filter((name) => !SKIP_HOST_SECRET_NAMES.has(name)),
  );

  const templateSecretNames = uniqSorted([...requiredSecrets, ...optionalSecrets]);
  const templateSecrets: Record<string, string> = {};
  for (const secretName of templateSecretNames) {
    if (garnixPrivateEnabled && secretName === garnixNetrcSecretName) {
      templateSecrets[secretName] = "<REPLACE_WITH_NETRC>";
      continue;
    }
    templateSecrets[secretName] = requiredSecretsSet.has(secretName) ? "<REPLACE_WITH_SECRET>" : "<OPTIONAL>";
  }

  const requiredSecretNames = uniqSorted([
    ...secretsPlan.hostSecretNamesRequired,
    ...(secretsPlan.required || []).map((spec) => spec.name),
  ]);

  return {
    requiresTailscaleAuthKey,
    requiredSecrets,
    optionalSecrets,
    templateSecrets,
    requiredSecretNames,
    garnixNetrcSecretName,
  };
}
