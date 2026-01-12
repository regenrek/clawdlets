import process from "node:process";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdbot/clawdlets-core/lib/opentofu";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { loadStack, loadStackEnv, resolveStackBaseFlake } from "@clawdbot/clawdlets-core/stack";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { requireDeployGate } from "../lib/deploy-gate.js";
import { needsSudo, requireTargetHost } from "./ssh-target.js";

function resolveHostFromFlake(flakeBase: string): string | null {
  const hashIndex = flakeBase.indexOf("#");
  if (hashIndex === -1) return null;
  const host = flakeBase.slice(hashIndex + 1).trim();
  return host.length > 0 ? host : null;
}

export const lockdown = defineCommand({
  meta: {
    name: "lockdown",
    description: "Rebuild over tailnet and remove public SSH from Hetzner firewall.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    flake: { type: "string", description: "Override base flake (default: stack.base.flake)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
    skipRebuild: { type: "boolean", description: "Skip nixos-rebuild.", default: false },
    skipTofu: { type: "boolean", description: "Skip opentofu apply.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    await requireDeployGate({ stackDir: args.stackDir, host: hostName, scope: "deploy", strict: true });

    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const envLoaded = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    const hcloudToken = String(envLoaded.env.HCLOUD_TOKEN || "").trim();
    const githubToken = String(envLoaded.env.GITHUB_TOKEN || "").trim();

    const baseResolved = await resolveStackBaseFlake({ repoRoot: layout.repoRoot, stack });
    const flakeBase = String(args.flake || baseResolved.flake || "").trim();
    if (!flakeBase) throw new Error("missing base flake (set stack.base.flake, set git origin, or pass --flake)");

    const rev = String(args.rev || "").trim();
    const ref = String(args.ref || "").trim();
    if (rev && ref) throw new Error("use either --rev or --ref (not both)");

    const requestedHost = String(host.flakeHost || hostName).trim() || hostName;
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
      if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (stack env)");
      const sshPubkeyFile = expandPath(host.opentofu.sshPubkeyFile);
      await applyOpenTofuVars({
        repoRoot: layout.repoRoot,
        vars: {
          hcloudToken,
          adminCidr: host.opentofu.adminCidr,
          sshPubkeyFile,
          serverType: host.hetzner.serverType,
          publicSsh: false,
        },
        nixBin: envLoaded.env.NIX_BIN || "nix",
        dryRun: args.dryRun,
        redact: [hcloudToken, githubToken].filter(Boolean) as string[],
      });
    }
  },
});
