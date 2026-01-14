import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdbot/clawdlets-core/lib/opentofu";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { loadDeployCreds } from "@clawdbot/clawdlets-core/lib/deploy-creds";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { loadClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { resolveBaseFlake } from "@clawdbot/clawdlets-core/lib/base-flake";
import { requireDeployGate } from "../lib/deploy-gate.js";
import { needsSudo, requireTargetHost } from "./ssh-target.js";
import { resolveHostNameOrExit } from "../lib/host-resolve.js";

function resolveHostFromFlake(flakeBase: string): string | null {
  const hashIndex = flakeBase.indexOf("#");
  if (hashIndex === -1) return null;
  const host = flakeBase.slice(hashIndex + 1).trim();
  return host.length > 0 ? host : null;
}

export const lockdown = defineCommand({
  meta: {
    name: "lockdown",
    description: "Remove public SSH from Hetzner firewall (optional host rebuild).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    flake: { type: "string", description: "Override base flake (default: clawdlets.json baseFlake or git origin)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
    skipRebuild: { type: "boolean", description: "Skip host rebuild (recommended for store-path deploys).", default: false },
    skipTofu: { type: "boolean", description: "Skip opentofu apply.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
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

    await requireDeployGate({
      runtimeDir: (args as any).runtimeDir,
      envFile: (args as any).envFile,
      host: hostName,
      scope: "deploy",
      strict: true,
      skipGithubTokenCheck: Boolean((args as any).skipRebuild),
    });

    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    const githubToken = String(deployCreds.values.GITHUB_TOKEN || "").trim();

    const baseResolved = await resolveBaseFlake({ repoRoot, config: clawdletsConfig });
    const flakeBase = String(args.flake || baseResolved.flake || "").trim();
    if (!flakeBase) throw new Error("missing base flake (set baseFlake in fleet/clawdlets.json, set git origin, or pass --flake)");

    const rev = String(args.rev || "").trim();
    const ref = String(args.ref || "").trim();
    if (rev && ref) throw new Error("use either --rev or --ref (not both)");

    const requestedHost = String(hostCfg.flakeHost || hostName).trim() || hostName;
    const hostFromFlake = resolveHostFromFlake(flakeBase);
    if (hostFromFlake && hostFromFlake !== requestedHost) throw new Error(`flake host mismatch: ${hostFromFlake} vs ${requestedHost}`);

    const flakeWithHost = flakeBase.includes("#") ? flakeBase : `${flakeBase}#${requestedHost}`;
    const hashIndex = flakeWithHost.indexOf("#");
    const flakeBasePath = hashIndex === -1 ? flakeWithHost : flakeWithHost.slice(0, hashIndex);
    const flakeFragment = hashIndex === -1 ? "" : flakeWithHost.slice(hashIndex);
    if ((rev || ref) && /(^|[?&])(rev|ref)=/.test(flakeBasePath)) {
      throw new Error("flake already includes ?rev/?ref; drop --rev/--ref");
    }

    let flakePinned = flakeWithHost;
    if (rev) {
      const resolved = await resolveGitRev(layout.repoRoot, rev);
      if (!resolved) throw new Error(`unable to resolve git rev: ${rev}`);
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flakePinned = `${flakeBasePath}${sep}rev=${resolved}${flakeFragment}`;
    } else if (ref) {
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flakePinned = `${flakeBasePath}${sep}ref=${ref}${flakeFragment}`;
    }

    if (!args.skipRebuild) {
      const sudo = needsSudo(targetHost);
      const remoteArgs: string[] = [];
      if (sudo) remoteArgs.push("sudo");
      remoteArgs.push("env");
      if (githubToken) remoteArgs.push(`NIX_CONFIG=access-tokens = github.com=${githubToken}`);
      remoteArgs.push("nixos-rebuild", "switch", "--flake", flakePinned);
      const remoteCmd = remoteArgs.map(shellQuote).join(" ");
      await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty, dryRun: args.dryRun });
    }

    if (!args.skipTofu) {
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
      await applyOpenTofuVars({
        repoRoot: layout.repoRoot,
        vars: {
          hcloudToken,
          adminCidr,
          sshPubkeyFile,
          serverType: hostCfg.hetzner.serverType,
          publicSsh: false,
        },
        nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
        dryRun: args.dryRun,
        redact: [hcloudToken, githubToken].filter(Boolean) as string[],
      });
    }
  },
});
