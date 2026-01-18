import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdlets/core/lib/opentofu";
import { expandPath } from "@clawdlets/core/lib/path-expand";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { getSshExposureMode, getTailnetMode, loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";
import { getHostOpenTofuDir } from "@clawdlets/core/repo-layout";
import { requireDeployGate } from "../lib/deploy-gate.js";
import { resolveHostNameOrExit } from "../lib/host-resolve.js";

export const lockdown = defineCommand({
  meta: {
    name: "lockdown",
    description: "Remove public SSH from Hetzner firewall (OpenTofu only).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    skipTofu: { type: "boolean", description: "Skip provisioning apply.", default: false },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;
    const { layout, config: clawdletsConfig } = loadClawdletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const hostCfg = clawdletsConfig.hosts[hostName];
    if (!hostCfg) throw new Error(`missing host in fleet/clawdlets.json: ${hostName}`);
    const opentofuDir = getHostOpenTofuDir(layout, hostName);
    const sshExposureMode = getSshExposureMode(hostCfg);
    if (sshExposureMode !== "tailnet") {
      throw new Error(`sshExposure.mode=${sshExposureMode}; set sshExposure.mode=tailnet before lockdown (clawdlets host set --host ${hostName} --ssh-exposure tailnet)`);
    }

    await requireDeployGate({
      runtimeDir: (args as any).runtimeDir,
      envFile: (args as any).envFile,
      host: hostName,
      scope: "server-deploy",
      strict: true,
      skipGithubTokenCheck: true,
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    const githubToken = String(deployCreds.values.GITHUB_TOKEN || "").trim();

    if (!args.skipTofu) {
      if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

      const adminCidr = String(hostCfg.provisioning.adminCidr || "").trim();
      if (!adminCidr) throw new Error(`missing provisioning.adminCidr for ${hostName} (set via: clawdlets host set --admin-cidr ...)`);

    const sshPubkeyFileRaw = String(hostCfg.provisioning.sshPubkeyFile || "").trim();
    if (!sshPubkeyFileRaw) throw new Error(`missing provisioning.sshPubkeyFile for ${hostName} (set via: clawdlets host set --ssh-pubkey-file ...)`);
    const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
    const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
      ? sshPubkeyFileExpanded
      : path.resolve(repoRoot, sshPubkeyFileExpanded);
    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);
      const image = String(hostCfg.hetzner.image || "").trim();
      const location = String(hostCfg.hetzner.location || "").trim();
      await applyOpenTofuVars({
        opentofuDir,
        vars: {
          hostName,
          hcloudToken,
          adminCidr,
          adminCidrIsWorldOpen: Boolean(hostCfg.provisioning.adminCidrAllowWorldOpen),
          sshPubkeyFile,
          serverType: hostCfg.hetzner.serverType,
          image,
          location,
          sshExposureMode,
          tailnetMode: getTailnetMode(hostCfg),
        },
        nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
        dryRun: args.dryRun,
        redact: [hcloudToken, githubToken].filter(Boolean) as string[],
      });
    }
  },
});
