import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { RepoLayout } from "../repo-layout.js";
import { loadClawdletsConfig } from "../lib/clawdlets-config.js";
import { getHostSecretsDir } from "../repo-layout.js";
import { sopsDecryptYamlFile } from "../lib/sops.js";
import { isPlaceholderSecretValue } from "../lib/secrets-init.js";
import type { DoctorCheck, DoctorPush } from "./types.js";

export async function addCattleChecks(params: {
  repoRoot: string;
  layout: RepoLayout;
  host: string;
  nixBin: string;
  hcloudToken?: string;
  sopsAgeKeyFile?: string;
  push: DoctorPush;
}): Promise<void> {
  const scope = "cattle" as const;
  const push = (c: Omit<DoctorCheck, "scope">) =>
    params.push({ scope, ...c });

  push({
    status: params.hcloudToken ? "ok" : "missing",
    label: "HCLOUD_TOKEN",
    detail: params.hcloudToken ? "(set)" : "(set in .clawdlets/env or env var; run: clawdlets env init)",
  });

  const { config } = loadClawdletsConfig({ repoRoot: params.repoRoot });
  const cattleEnabled = Boolean((config as any).cattle?.enabled);
  const cattleImage = String((config as any).cattle?.hetzner?.image || "").trim();

  push({
    status: cattleEnabled ? "ok" : "warn",
    label: "cattle.enabled",
    detail: cattleEnabled ? "true" : "false (cattle commands disabled)",
  });

  push({
    status: cattleEnabled && cattleImage ? "ok" : cattleEnabled ? "missing" : "warn",
    label: "cattle.hetzner.image",
    detail: cattleImage ? cattleImage : "(unset)",
  });

  const hostCfg = config.hosts[params.host];
  const sshKeys = hostCfg?.sshAuthorizedKeys || [];
  push({
    status: Array.isArray(sshKeys) && sshKeys.length > 0 ? "ok" : "warn",
    label: "sshAuthorizedKeys",
    detail: Array.isArray(sshKeys) && sshKeys.length > 0 ? "(set)" : "(empty; cattle ssh/logs will fail)",
  });

  const localDir = getHostSecretsDir(params.layout, params.host);
  const tsSecret = path.join(localDir, "tailscale_auth_key.yaml");
  push({
    status: fs.existsSync(tsSecret) ? "ok" : cattleEnabled ? "missing" : "warn",
    label: "tailscale_auth_key secret",
    detail: tsSecret,
  });

  if (fs.existsSync(tsSecret) && params.sopsAgeKeyFile && fs.existsSync(params.sopsAgeKeyFile)) {
    try {
      const nix = { nixBin: params.nixBin, cwd: params.repoRoot, dryRun: false } as const;
      const decrypted = await sopsDecryptYamlFile({ filePath: tsSecret, ageKeyFile: params.sopsAgeKeyFile, nix });
      const parsed = (YAML.parse(decrypted) as Record<string, unknown>) || {};
      const v = parsed["tailscale_auth_key"];
      const value = typeof v === "string" ? v : v == null ? "" : String(v);
      push({
        status: value.trim() && !isPlaceholderSecretValue(value) ? "ok" : "missing",
        label: "tailscale_auth_key value",
        detail: value.trim() && !isPlaceholderSecretValue(value) ? "(ok)" : "(missing/placeholder)",
      });
    } catch (e) {
      push({
        status: "missing",
        label: "tailscale_auth_key decrypt",
        detail: String((e as Error)?.message || e),
      });
    }
  }
}
