import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { applyOpenTofuVars, destroyOpenTofuVars } from "@clawdbot/clawdlets-core/lib/opentofu";
import { loadDeployCreds } from "@clawdbot/clawdlets-core/lib/deploy-creds";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { getSshExposureMode, getTailnetMode, loadClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { resolveHostNameOrExit } from "../lib/host-resolve.js";

const infraApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Hetzner OpenTofu for a host (driven by fleet/clawdlets.json).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
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

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const adminCidr = String(hostCfg.opentofu.adminCidr || "").trim();
    if (!adminCidr) throw new Error(`missing opentofu.adminCidr for ${hostName} (set via: clawdlets host set --admin-cidr ...)`);

    const sshPubkeyFileRaw = String(hostCfg.opentofu.sshPubkeyFile || "").trim();
    if (!sshPubkeyFileRaw) throw new Error(`missing opentofu.sshPubkeyFile for ${hostName} (set via: clawdlets host set --ssh-pubkey-file ...)`);
    const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
    const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
      ? sshPubkeyFileExpanded
      : path.resolve(repoRoot, sshPubkeyFileExpanded);
    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);
    const image = String(hostCfg.hetzner.image || "").trim();
    const location = String(hostCfg.hetzner.location || "").trim();

    await applyOpenTofuVars({
      repoRoot: layout.repoRoot,
      vars: {
        hcloudToken,
        adminCidr,
        sshPubkeyFile,
        serverType: hostCfg.hetzner.serverType,
        image,
        location,
        sshExposureMode: getSshExposureMode(hostCfg),
        tailnetMode: getTailnetMode(hostCfg),
      },
      nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
      dryRun: args.dryRun,
      redact: [hcloudToken, deployCreds.values.GITHUB_TOKEN].filter(Boolean) as string[],
    });

    console.log(`ok: opentofu applied for ${hostName}`);
    console.log(`hint: outputs in ${layout.opentofuDir}`);
  },
});

const infraDestroy = defineCommand({
  meta: {
    name: "destroy",
    description: "Destroy Hetzner OpenTofu resources for a host (DANGEROUS).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    force: { type: "boolean", description: "Skip confirmation prompt (non-interactive).", default: false },
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

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const adminCidr = String(hostCfg.opentofu.adminCidr || "").trim();
    if (!adminCidr) throw new Error(`missing opentofu.adminCidr for ${hostName} (set via: clawdlets host set --admin-cidr ...)`);

    const sshPubkeyFileRaw = String(hostCfg.opentofu.sshPubkeyFile || "").trim();
    if (!sshPubkeyFileRaw) throw new Error(`missing opentofu.sshPubkeyFile for ${hostName} (set via: clawdlets host set --ssh-pubkey-file ...)`);
    const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
    const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
      ? sshPubkeyFileExpanded
      : path.resolve(repoRoot, sshPubkeyFileExpanded);
    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);
    const image = String(hostCfg.hetzner.image || "").trim();
    const location = String(hostCfg.hetzner.location || "").trim();

    const force = Boolean((args as any).force);
    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    if (!force) {
      if (!interactive) throw new Error("refusing to destroy without --force (no TTY)");
      p.intro("clawdlets infra destroy");
      const ok = await p.confirm({
        message: `Destroy Hetzner resources for host ${hostName}?`,
        initialValue: false,
      });
      if (p.isCancel(ok) || !ok) {
        p.cancel("canceled");
        return;
      }
    }

    await destroyOpenTofuVars({
      repoRoot: layout.repoRoot,
      vars: {
        hcloudToken,
        adminCidr,
        sshPubkeyFile,
        serverType: hostCfg.hetzner.serverType,
        image,
        location,
        sshExposureMode: getSshExposureMode(hostCfg),
        tailnetMode: getTailnetMode(hostCfg),
      },
      nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
      dryRun: args.dryRun,
      redact: [hcloudToken, deployCreds.values.GITHUB_TOKEN].filter(Boolean) as string[],
    });

    console.log(`ok: opentofu destroyed for ${hostName}`);
    console.log(`hint: state in ${layout.opentofuDir}`);
  },
});

export const infra = defineCommand({
  meta: {
    name: "infra",
    description: "Infrastructure operations (Hetzner OpenTofu).",
  },
  subCommands: {
    apply: infraApply,
    destroy: infraDestroy,
  },
});
