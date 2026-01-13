import fs from "node:fs";
import path from "node:path";
import { ensureHcloudSshKeyId } from "./hcloud.js";
import { run } from "./run.js";
import type { LoadEnvResult } from "./env.js";
import { withFlakesEnv } from "./nix-flakes.js";

export type OpenTofuApplyParams = {
  loaded: LoadEnvResult;
  serverType?: string;
  publicSsh: boolean;
  dryRun?: boolean;
};

export type OpenTofuApplyVars = {
  hcloudToken: string;
  adminCidr: string;
  sshPubkeyFile: string;
  serverType?: string;
  publicSsh: boolean;
};

export async function applyOpenTofuVars(params: {
  repoRoot: string;
  vars: OpenTofuApplyVars;
  nixBin?: string;
  dryRun?: boolean;
  redact?: string[];
}): Promise<void> {
  const repoRoot = params.repoRoot;
  const opentofuDir = path.join(repoRoot, "infra", "opentofu");

  const resolvedServerType = params.vars.serverType?.trim() || "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HCLOUD_TOKEN: params.vars.hcloudToken,
    ADMIN_CIDR: params.vars.adminCidr,
    SSH_PUBKEY_FILE: params.vars.sshPubkeyFile,
    SERVER_TYPE: resolvedServerType,
  };

  const nixBin = params.nixBin || "nix";
  const tofuEnv = {
    ...env,
  };
  const tofuEnvWithFlakes = withFlakesEnv(tofuEnv);
  const tofuArgs = (tfArgs: string[]): string[] => [
    "run",
    "--impure",
    "nixpkgs#opentofu",
    "--",
    ...tfArgs,
  ];
  const redact = (params.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(nixBin, tofuArgs(["init", "-input=false"]), {
    cwd: opentofuDir,
    env: tofuEnvWithFlakes,
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

  await run(nixBin, tofuArgs(tfApplyArgs), {
    cwd: opentofuDir,
    env: tofuEnvWithFlakes,
    dryRun: params.dryRun,
    redact,
  });
}

export async function destroyOpenTofuVars(params: {
  repoRoot: string;
  vars: OpenTofuApplyVars;
  nixBin?: string;
  dryRun?: boolean;
  redact?: string[];
}): Promise<void> {
  const repoRoot = params.repoRoot;
  const opentofuDir = path.join(repoRoot, "infra", "opentofu");

  const resolvedServerType = params.vars.serverType?.trim() || "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HCLOUD_TOKEN: params.vars.hcloudToken,
    ADMIN_CIDR: params.vars.adminCidr,
    SSH_PUBKEY_FILE: params.vars.sshPubkeyFile,
    SERVER_TYPE: resolvedServerType,
  };

  const nixBin = params.nixBin || "nix";
  const tofuEnv = {
    ...env,
  };
  const tofuEnvWithFlakes = withFlakesEnv(tofuEnv);
  const tofuArgs = (tfArgs: string[]): string[] => [
    "run",
    "--impure",
    "nixpkgs#opentofu",
    "--",
    ...tfArgs,
  ];
  const redact = (params.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(nixBin, tofuArgs(["init", "-input=false"]), {
    cwd: opentofuDir,
    env: tofuEnvWithFlakes,
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

  const tfDestroyArgs = [
    "destroy",
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
  if (env.SERVER_TYPE) tfDestroyArgs.push("-var", `server_type=${env.SERVER_TYPE}`);

  await run(nixBin, tofuArgs(tfDestroyArgs), {
    cwd: opentofuDir,
    env: tofuEnvWithFlakes,
    dryRun: params.dryRun,
    redact,
  });
}

export async function applyOpenTofu(params: OpenTofuApplyParams): Promise<void> {
  const resolvedServerType = params.serverType?.trim() || params.loaded.env.SERVER_TYPE || "";
  const vars: OpenTofuApplyVars = {
    hcloudToken: params.loaded.env.HCLOUD_TOKEN,
    adminCidr: params.loaded.env.ADMIN_CIDR,
    sshPubkeyFile: params.loaded.env.SSH_PUBKEY_FILE,
    serverType: resolvedServerType || undefined,
    publicSsh: params.publicSsh,
  };
  const redact = [params.loaded.env.HCLOUD_TOKEN, params.loaded.env.GITHUB_TOKEN].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  await applyOpenTofuVars({
    repoRoot: params.loaded.repoRoot,
    vars,
    nixBin: params.loaded.env.NIX_BIN || "nix",
    dryRun: params.dryRun,
    redact,
  });
}
