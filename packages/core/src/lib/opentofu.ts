import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHcloudSshKeyId } from "./hcloud.js";
import type { SshExposureMode, TailnetMode } from "./clawdlets-config.js";
import { run } from "./run.js";
import { withFlakesEnv } from "./nix-flakes.js";

function resolveBundledOpenTofuDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "assets", "opentofu");
}

function ensureOpenTofuWorkDir(opentofuDir: string): void {
  const srcDir = resolveBundledOpenTofuDir();
  if (!fs.existsSync(srcDir)) throw new Error(`missing bundled OpenTofu module dir: ${srcDir}`);

  fs.mkdirSync(opentofuDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = path.join(srcDir, e.name);
    const dest = path.join(opentofuDir, e.name);
    fs.cpSync(src, dest, { recursive: true });
  }
}

export type OpenTofuApplyVars = {
  hostName: string;
  hcloudToken: string;
  adminCidr: string;
  adminCidrIsWorldOpen: boolean;
  sshPubkeyFile: string;
  serverType?: string;
  image?: string;
  location?: string;
  sshExposureMode: SshExposureMode;
  tailnetMode: TailnetMode;
};

export async function applyOpenTofuVars(params: {
  opentofuDir: string;
  vars: OpenTofuApplyVars;
  nixBin?: string;
  dryRun?: boolean;
  redact?: string[];
}): Promise<void> {
  const opentofuDir = params.opentofuDir;
  ensureOpenTofuWorkDir(opentofuDir);

  const hostName = String(params.vars.hostName || "").trim();
  if (!hostName) throw new Error("missing OpenTofu hostName");

  const resolvedServerType = params.vars.serverType?.trim() || "";
  const resolvedImage = params.vars.image?.trim() || "";
  const resolvedLocation = params.vars.location?.trim() || "";
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
    `host_name=${hostName}`,
    "-var",
    `hcloud_token=${env.HCLOUD_TOKEN}`,
    "-var",
    `admin_cidr=${env.ADMIN_CIDR}`,
    "-var",
    `admin_cidr_is_world_open=${params.vars.adminCidrIsWorldOpen ? "true" : "false"}`,
    "-var",
    `ssh_key_id=${sshKeyId}`,
    "-var",
    `ssh_exposure_mode=${params.vars.sshExposureMode}`,
    "-var",
    `tailnet_mode=${params.vars.tailnetMode}`,
  ];
  if (env.SERVER_TYPE) tfApplyArgs.push("-var", `server_type=${env.SERVER_TYPE}`);
  if (resolvedImage) tfApplyArgs.push("-var", `image=${resolvedImage}`);
  if (resolvedLocation) tfApplyArgs.push("-var", `location=${resolvedLocation}`);

  await run(nixBin, tofuArgs(tfApplyArgs), {
    cwd: opentofuDir,
    env: tofuEnvWithFlakes,
    dryRun: params.dryRun,
    redact,
  });
}

export async function destroyOpenTofuVars(params: {
  opentofuDir: string;
  vars: OpenTofuApplyVars;
  nixBin?: string;
  dryRun?: boolean;
  redact?: string[];
}): Promise<void> {
  const opentofuDir = params.opentofuDir;
  ensureOpenTofuWorkDir(opentofuDir);

  const hostName = String(params.vars.hostName || "").trim();
  if (!hostName) throw new Error("missing OpenTofu hostName");

  const resolvedServerType = params.vars.serverType?.trim() || "";
  const resolvedImage = params.vars.image?.trim() || "";
  const resolvedLocation = params.vars.location?.trim() || "";
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
    `host_name=${hostName}`,
    "-var",
    `hcloud_token=${env.HCLOUD_TOKEN}`,
    "-var",
    `admin_cidr=${env.ADMIN_CIDR}`,
    "-var",
    `admin_cidr_is_world_open=${params.vars.adminCidrIsWorldOpen ? "true" : "false"}`,
    "-var",
    `ssh_key_id=${sshKeyId}`,
    "-var",
    `ssh_exposure_mode=${params.vars.sshExposureMode}`,
    "-var",
    `tailnet_mode=${params.vars.tailnetMode}`,
  ];
  if (env.SERVER_TYPE) tfDestroyArgs.push("-var", `server_type=${env.SERVER_TYPE}`);
  if (resolvedImage) tfDestroyArgs.push("-var", `image=${resolvedImage}`);
  if (resolvedLocation) tfDestroyArgs.push("-var", `location=${resolvedLocation}`);

  await run(nixBin, tofuArgs(tfDestroyArgs), {
    cwd: opentofuDir,
    env: tofuEnvWithFlakes,
    dryRun: params.dryRun,
    redact,
  });
}
