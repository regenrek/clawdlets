import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdbot/clawdlets-core/lib/opentofu";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { loadClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { resolveHostNameOrExit } from "../lib/host-resolve.js";

const infraApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Hetzner OpenTofu for a host (public SSH toggle lives in server/lockdown).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    "public-ssh": {
      type: "boolean",
      description: "Whether public SSH (22) is open in Hetzner firewall.",
      default: false,
    },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;
    const { layout, config: clawdletsConfig } = loadClawdletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const hostCfg = clawdletsConfig.hosts[hostName];
    if (!hostCfg) throw new Error(`missing host in infra/configs/clawdlets.json: ${hostName}`);

    const hcloudToken = String(process.env.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set env var)");

    const adminCidr = String(hostCfg.opentofu.adminCidr || "").trim();
    if (!adminCidr) throw new Error(`missing opentofu.adminCidr for ${hostName} (set via: clawdlets host set --admin-cidr ...)`);

    const sshPubkeyFileRaw = String(hostCfg.opentofu.sshPubkeyFile || "").trim();
    if (!sshPubkeyFileRaw) throw new Error(`missing opentofu.sshPubkeyFile for ${hostName} (set via: clawdlets host set --ssh-pubkey-file ...)`);
    const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
    const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
      ? sshPubkeyFileExpanded
      : path.resolve(repoRoot, sshPubkeyFileExpanded);
    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);

    await applyOpenTofuVars({
      repoRoot: layout.repoRoot,
      vars: {
        hcloudToken,
        adminCidr,
        sshPubkeyFile,
        serverType: hostCfg.hetzner.serverType,
        publicSsh: Boolean((args as any)["public-ssh"]),
      },
      nixBin: String(process.env.NIX_BIN || "nix").trim() || "nix",
      dryRun: args.dryRun,
      redact: [hcloudToken, process.env.GITHUB_TOKEN].filter(Boolean) as string[],
    });

    console.log(`ok: opentofu applied for ${hostName}`);
    console.log(`hint: outputs in ${layout.opentofuDir}`);
  },
});

export const infra = defineCommand({
  meta: {
    name: "infra",
    description: "Infrastructure operations (Hetzner OpenTofu).",
  },
  subCommands: {
    apply: infraApply,
  },
});
