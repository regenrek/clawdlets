import fs from "node:fs";
import path from "node:path";
import { ensureHcloudSshKeyId } from "./hcloud.js";
import { run } from "./run.js";
import type { LoadEnvResult } from "./env.js";
import { withFlakesEnv } from "./nix-flakes.js";

export type TerraformApplyParams = {
  loaded: LoadEnvResult;
  serverType?: string;
  publicSsh: boolean;
  dryRun?: boolean;
};

export type TerraformApplyVars = {
  hcloudToken: string;
  adminCidr: string;
  sshPubkeyFile: string;
  serverType?: string;
  publicSsh: boolean;
};

export async function applyTerraformVars(params: {
  repoRoot: string;
  vars: TerraformApplyVars;
  nixBin?: string;
  dryRun?: boolean;
  redact?: string[];
}): Promise<void> {
  const repoRoot = params.repoRoot;
  const terraformDir = path.join(repoRoot, "infra", "terraform");

  const resolvedServerType = params.vars.serverType?.trim() || "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HCLOUD_TOKEN: params.vars.hcloudToken,
    ADMIN_CIDR: params.vars.adminCidr,
    SSH_PUBKEY_FILE: params.vars.sshPubkeyFile,
    SERVER_TYPE: resolvedServerType,
  };

  const nixBin = params.nixBin || "nix";
  const terraformEnv = {
    ...env,
    NIXPKGS_ALLOW_UNFREE: String(env.NIXPKGS_ALLOW_UNFREE || "").trim() || "1",
  };
  const terraformEnvWithFlakes = withFlakesEnv(terraformEnv);
  const terraformArgs = (tfArgs: string[]): string[] => [
    "run",
    "--impure",
    "nixpkgs#terraform",
    "--",
    ...tfArgs,
  ];
  const redact = (params.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(nixBin, terraformArgs(["init", "-input=false"]), {
    cwd: terraformDir,
    env: terraformEnvWithFlakes,
    dryRun: params.dryRun,
    redact,
  });

  const sshPublicKey = fs.readFileSync(params.vars.sshPubkeyFile, "utf8").trim();
  const sshKeyId = params.dryRun
    ? "<hcloud-ssh-key-id>"
    : await ensureHcloudSshKeyId({
        token: params.vars.hcloudToken,
        name: "clawdbot-admin",
        publicKey: sshPublicKey,
      });

  const tfApplyArgs = [
    "apply",
    "-auto-approve",
    "-input=false",
    "-var",
    `hcloud_token=${env.HCLOUD_TOKEN}`,
    "-var",
    `admin_cidr=${env.ADMIN_CIDR}`,
    "-var",
    `ssh_key_id=${sshKeyId}`,
    "-var",
    `public_ssh=${params.vars.publicSsh ? "true" : "false"}`,
  ];
  if (env.SERVER_TYPE) tfApplyArgs.push("-var", `server_type=${env.SERVER_TYPE}`);

  await run(nixBin, terraformArgs(tfApplyArgs), {
    cwd: terraformDir,
    env: terraformEnvWithFlakes,
    dryRun: params.dryRun,
    redact,
  });
}

export async function applyTerraform(params: TerraformApplyParams): Promise<void> {
  const resolvedServerType = params.serverType?.trim() || params.loaded.env.SERVER_TYPE || "";
  const vars: TerraformApplyVars = {
    hcloudToken: params.loaded.env.HCLOUD_TOKEN,
    adminCidr: params.loaded.env.ADMIN_CIDR,
    sshPubkeyFile: params.loaded.env.SSH_PUBKEY_FILE,
    serverType: resolvedServerType || undefined,
    publicSsh: params.publicSsh,
  };
  const redact = [params.loaded.env.HCLOUD_TOKEN, params.loaded.env.GITHUB_TOKEN].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  await applyTerraformVars({
    repoRoot: params.loaded.repoRoot,
    vars,
    nixBin: params.loaded.env.NIX_BIN || "nix",
    dryRun: params.dryRun,
    redact,
  });
}
