import path from "node:path";
import { assertSafeHostName, assertSafeOperatorId, assertSafeSecretName } from "./lib/identifiers.js";

export type RepoLayout = {
  repoRoot: string;

  // Local runtime dir (gitignored). Defaults to <repoRoot>/.clawdlets.
  runtimeDir: string;

  // Local deploy creds env file (gitignored). Defaults to <runtimeDir>/env.
  envFilePath: string;

  // Local cattle state (gitignored). Defaults to <runtimeDir>/cattle.
  cattleDir: string;
  cattleDbPath: string;

  // Local infra state (gitignored). Defaults to <runtimeDir>/infra.
  runtimeInfraDir: string;
  opentofuDir: string;

  // Fleet (app layer): bot roster, routing, skills, workspace docs.
  fleetDir: string;
  clawdletsConfigPath: string;
  bundledSkillsPath: string;

  // Canonical secrets dir (committed; encrypted-at-rest via sops).
  secretsDir: string;
  secretsHostsDir: string;
  secretsKeysDir: string;
  secretsHostKeysDir: string;
  extraFilesDir: string;
  sopsConfigPath: string;

  // Local private keys (gitignored).
  localKeysDir: string;
  localOperatorKeysDir: string;
};

export function getRepoLayout(repoRoot: string, runtimeDir?: string): RepoLayout {
  const resolvedRuntimeDir = runtimeDir ?? path.join(repoRoot, ".clawdlets");
  const envFilePath = path.join(resolvedRuntimeDir, "env");
  const cattleDir = path.join(resolvedRuntimeDir, "cattle");
  const cattleDbPath = path.join(cattleDir, "state.sqlite");
  const runtimeInfraDir = path.join(resolvedRuntimeDir, "infra");
  const opentofuDir = path.join(runtimeInfraDir, "opentofu");
  const fleetDir = path.join(repoRoot, "fleet");
  const clawdletsConfigPath = path.join(fleetDir, "clawdlets.json");
  const bundledSkillsPath = path.join(fleetDir, "bundled-skills.json");
  const secretsDir = path.join(repoRoot, "secrets");
  const secretsHostsDir = path.join(secretsDir, "hosts");
  const extraFilesDir = path.join(resolvedRuntimeDir, "extra-files");
  const secretsKeysDir = path.join(secretsDir, "keys");
  const secretsHostKeysDir = path.join(secretsKeysDir, "hosts");
  const sopsConfigPath = path.join(secretsDir, ".sops.yaml");
  const localKeysDir = path.join(resolvedRuntimeDir, "keys");
  const localOperatorKeysDir = path.join(localKeysDir, "operators");

  return {
    repoRoot,
    runtimeDir: resolvedRuntimeDir,
    envFilePath,
    cattleDir,
    cattleDbPath,
    runtimeInfraDir,
    opentofuDir,
    fleetDir,
    clawdletsConfigPath,
    bundledSkillsPath,
    secretsDir,
    secretsHostsDir,
    secretsKeysDir,
    secretsHostKeysDir,
    extraFilesDir,
    sopsConfigPath,
    localKeysDir,
    localOperatorKeysDir,
  };
}

export function getHostOpenTofuDir(layout: RepoLayout, host: string): string {
  assertSafeHostName(host);
  return path.join(layout.opentofuDir, host);
}

export function getHostSecretsDir(layout: RepoLayout, host: string): string {
  assertSafeHostName(host);
  return path.join(layout.secretsHostsDir, host);
}

export function getHostSecretFile(layout: RepoLayout, host: string, secretName: string): string {
  assertSafeHostName(host);
  assertSafeSecretName(secretName);
  return path.join(getHostSecretsDir(layout, host), `${secretName}.yaml`);
}

export function getHostExtraFilesDir(layout: RepoLayout, host: string): string {
  assertSafeHostName(host);
  return path.join(layout.extraFilesDir, host);
}

export function getHostExtraFilesKeyPath(layout: RepoLayout, host: string): string {
  assertSafeHostName(host);
  return path.join(getHostExtraFilesDir(layout, host), "var", "lib", "sops-nix", "key.txt");
}

export function getHostExtraFilesSecretsDir(layout: RepoLayout, host: string): string {
  assertSafeHostName(host);
  return path.join(getHostExtraFilesDir(layout, host), "var", "lib", "clawdlets", "secrets", "hosts", host);
}

export function getHostRemoteSecretsDir(host: string): string {
  assertSafeHostName(host);
  return `/var/lib/clawdlets/secrets/hosts/${host}`;
}

export function getLocalOperatorAgeKeyPath(layout: RepoLayout, operatorId: string): string {
  assertSafeOperatorId(operatorId);
  return path.join(layout.localOperatorKeysDir, `${operatorId}.agekey`);
}

export function getHostEncryptedAgeKeyFile(layout: RepoLayout, host: string): string {
  assertSafeHostName(host);
  return path.join(layout.secretsHostKeysDir, `${host}.agekey.yaml`);
}
