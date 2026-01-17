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

  infraDir: string;
  opentofuDir: string;

  // Fleet (app layer): bot roster, routing, skills, workspace docs.
  fleetDir: string;
  clawdletsConfigPath: string;
  fleetConfigPath: string;
  bundledSkillsPath: string;

  nixDir: string;
  nixHostsDir: string;
  nixHostModulePath: string;

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
  const infraDir = path.join(repoRoot, "infra");
  const opentofuDir = path.join(infraDir, "opentofu");
  const fleetDir = path.join(repoRoot, "fleet");
  const clawdletsConfigPath = path.join(fleetDir, "clawdlets.json");
  const fleetConfigPath = path.join(infraDir, "configs", "fleet.nix");
  const bundledSkillsPath = path.join(fleetDir, "bundled-skills.json");
  const nixDir = path.join(infraDir, "nix");
  const nixHostsDir = path.join(nixDir, "hosts");
  const nixHostModulePath = path.join(nixHostsDir, "clawdlets-host.nix");
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
    infraDir,
    opentofuDir,
    fleetDir,
    clawdletsConfigPath,
    fleetConfigPath,
    bundledSkillsPath,
    nixDir,
    nixHostsDir,
    nixHostModulePath,
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

export function getHostNixPath(layout: RepoLayout, host: string): string {
  void host;
  return layout.nixHostModulePath;
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
