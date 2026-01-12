import path from "node:path";
import { assertSafeHostName, assertSafeSecretName } from "./lib/identifiers.js";

export type RepoLayout = {
  repoRoot: string;

  stackDir: string;

  infraDir: string;
  opentofuDir: string;
  configsDir: string;
  clawdletsConfigPath: string;
  fleetConfigPath: string;

  nixDir: string;
  nixHostsDir: string;
  nixHostModulePath: string;

  secretsDir: string;
  secretsHostsDir: string;
  secretsOperatorsDir: string;
  extraFilesDir: string;
  sopsConfigPath: string;
};

export function getRepoLayout(repoRoot: string, stackDir?: string): RepoLayout {
  const resolvedStackDir = stackDir ?? path.join(repoRoot, ".clawdlets");
  const infraDir = path.join(repoRoot, "infra");
  const opentofuDir = path.join(infraDir, "opentofu");
  const configsDir = path.join(infraDir, "configs");
  const clawdletsConfigPath = path.join(configsDir, "clawdlets.json");
  const fleetConfigPath = path.join(configsDir, "fleet.nix");
  const nixDir = path.join(infraDir, "nix");
  const nixHostsDir = path.join(nixDir, "hosts");
  const nixHostModulePath = path.join(nixHostsDir, "clawdlets-host.nix");
  const secretsDir = path.join(resolvedStackDir, "secrets");
  const secretsHostsDir = path.join(secretsDir, "hosts");
  const secretsOperatorsDir = path.join(secretsDir, "operators");
  const extraFilesDir = path.join(resolvedStackDir, "extra-files");
  const sopsConfigPath = path.join(secretsDir, ".sops.yaml");

  return {
    repoRoot,
    stackDir: resolvedStackDir,
    infraDir,
    opentofuDir,
    configsDir,
    clawdletsConfigPath,
    fleetConfigPath,
    nixDir,
    nixHostsDir,
    nixHostModulePath,
    secretsDir,
    secretsHostsDir,
    secretsOperatorsDir,
    extraFilesDir,
    sopsConfigPath,
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
