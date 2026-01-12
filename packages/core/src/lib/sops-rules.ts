import path from "node:path";
import type { RepoLayout } from "../repo-layout.js";
import { getHostEncryptedAgeKeyFile, getHostSecretsDir } from "../repo-layout.js";
import { sopsPathRegexForDirFiles, sopsPathRegexForPathSuffix } from "./sops-config.js";
import { relativePathForSopsRule } from "./sops-path.js";

export function getHostSecretsSopsCreationRulePathSuffix(layout: RepoLayout, host: string): string {
  const configDir = path.dirname(layout.sopsConfigPath);
  const hostSecretsDir = getHostSecretsDir(layout, host);
  return relativePathForSopsRule({ fromDir: configDir, toPath: hostSecretsDir, label: "host secrets dir" });
}

export function getHostAgeKeySopsCreationRulePathSuffix(layout: RepoLayout, host: string): string {
  const configDir = path.dirname(layout.sopsConfigPath);
  const hostKeyFile = getHostEncryptedAgeKeyFile(layout, host);
  return relativePathForSopsRule({ fromDir: configDir, toPath: hostKeyFile, label: "host age key file" });
}

export function getHostSecretsSopsCreationRulePathRegex(layout: RepoLayout, host: string): string {
  return sopsPathRegexForDirFiles(getHostSecretsSopsCreationRulePathSuffix(layout, host), "yaml");
}

export function getHostAgeKeySopsCreationRulePathRegex(layout: RepoLayout, host: string): string {
  return sopsPathRegexForPathSuffix(getHostAgeKeySopsCreationRulePathSuffix(layout, host));
}
