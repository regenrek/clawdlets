import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdbot/clawdlets-core/lib/opentofu";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { capture, run } from "@clawdbot/clawdlets-core/lib/run";
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "@clawdbot/clawdlets-core/lib/github";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { evalFleetConfig } from "@clawdbot/clawdlets-core/lib/fleet-nix-eval";
import { withFlakesEnv } from "@clawdbot/clawdlets-core/lib/nix-flakes";
import { loadClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { resolveBaseFlake } from "@clawdbot/clawdlets-core/lib/base-flake";
import { getHostExtraFilesDir, getHostExtraFilesKeyPath, getHostExtraFilesSecretsDir } from "@clawdbot/clawdlets-core/repo-layout";
import { requireDeployGate } from "../lib/deploy-gate.js";
import { resolveHostNameOrExit } from "../lib/host-resolve.js";

async function purgeKnownHosts(ipv4: string, opts: { dryRun: boolean }) {
  const rm = async (host: string) => {
    if (opts.dryRun) {
      console.log(`ssh-keygen -R ${host}`);
      return;
    }
    await run("ssh-keygen", ["-R", host]);
  };
  await rm(ipv4);
  await rm(`[${ipv4}]:22`);
}

function resolveHostFromFlake(flakeBase: string): string | null {
  const hashIndex = flakeBase.indexOf("#");
  if (hashIndex === -1) return null;
  const host = flakeBase.slice(hashIndex + 1).trim();
  return host.length > 0 ? host : null;
}

export const bootstrap = defineCommand({
  meta: {
    name: "bootstrap",
    description: "Provision Hetzner VM + install NixOS via nixos-anywhere.",
	  },
	  args: {
	    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
	    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
	    flake: { type: "string", description: "Override base flake (default: clawdlets.json baseFlake or git origin)." },
	    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
	    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
	    "keep-public-ssh": { type: "boolean", description: "Keep public SSH open after install (not recommended).", default: false },
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

	    await requireDeployGate({ runtimeDir: (args as any).runtimeDir, host: hostName, scope: "deploy", strict: false });

	    const hcloudToken = String(process.env.HCLOUD_TOKEN || "").trim();
	    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set env var)");
	    const githubToken = String(process.env.GITHUB_TOKEN || "").trim();

	    const nixBin = String(process.env.NIX_BIN || "nix").trim() || "nix";
	    const opentofuDir = layout.opentofuDir;

	    const serverType = String(hostCfg.hetzner.serverType || "").trim();
	    if (!serverType) throw new Error(`missing hetzner.serverType for ${hostName} (set via: clawdlets host set --server-type ...)`);

	    const adminCidr = String(hostCfg.opentofu.adminCidr || "").trim();
	    if (!adminCidr) throw new Error(`missing opentofu.adminCidr for ${hostName} (set via: clawdlets host set --admin-cidr ...)`);

	    const sshPubkeyFileRaw = String(hostCfg.opentofu.sshPubkeyFile || "").trim();
	    if (!sshPubkeyFileRaw) throw new Error(`missing opentofu.sshPubkeyFile for ${hostName} (set via: clawdlets host set --ssh-pubkey-file ...)`);
	    const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
	    const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded) ? sshPubkeyFileExpanded : path.resolve(repoRoot, sshPubkeyFileExpanded);
	    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);

	    await applyOpenTofuVars({
	      repoRoot,
	      vars: {
	        hcloudToken,
	        adminCidr,
	        sshPubkeyFile,
	        serverType,
	        publicSsh: true,
	      },
	      nixBin,
	      dryRun: args.dryRun,
      redact: [hcloudToken, githubToken].filter(Boolean) as string[],
    });

	    const tofuEnv: NodeJS.ProcessEnv = {
	      ...process.env,
	      HCLOUD_TOKEN: hcloudToken,
	      ADMIN_CIDR: adminCidr,
	      SSH_PUBKEY_FILE: sshPubkeyFile,
	      SERVER_TYPE: serverType,
	    };
    const tofuEnvWithFlakes = withFlakesEnv(tofuEnv);

    const ipv4 = args.dryRun
      ? "<opentofu-output:ipv4>"
      : await capture(
          nixBin,
          ["run", "--impure", "nixpkgs#opentofu", "--", "output", "-raw", "ipv4"],
          { cwd: opentofuDir, env: tofuEnvWithFlakes, dryRun: args.dryRun },
        );

    console.log(`Target IPv4: ${ipv4}`);
    await purgeKnownHosts(ipv4, { dryRun: args.dryRun });

	    const baseResolved = await resolveBaseFlake({ repoRoot, config: clawdletsConfig });
	    const flakeBase = String(args.flake || baseResolved.flake || "").trim();
	    if (!flakeBase) throw new Error("missing base flake (set baseFlake in infra/configs/clawdlets.json, set git origin, or pass --flake)");

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
      const resolved = await resolveGitRev(repoRoot, rev);
      if (!resolved) throw new Error(`unable to resolve git rev: ${rev}`);
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flakePinned = `${flakeBasePath}${sep}rev=${resolved}${flakeFragment}`;
    } else if (ref) {
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flakePinned = `${flakeBasePath}${sep}ref=${ref}${flakeFragment}`;
    }

    const githubRepo = tryParseGithubFlakeUri(flakeBasePath);
    if (githubRepo && !args.dryRun) {
      const check = await checkGithubRepoVisibility({
        owner: githubRepo.owner,
        repo: githubRepo.repo,
        token: githubToken || undefined,
      });
	      if (check.ok && check.status === "private-or-missing" && !githubToken) {
	        throw new Error(`base flake repo appears private (404). Set GITHUB_TOKEN in your environment and retry.`);
	      }
      if (check.ok && check.status === "unauthorized") {
        throw new Error(`GITHUB_TOKEN rejected by GitHub (401).`);
      }
    }

	    const extraFiles = getHostExtraFilesDir(layout, hostName);
	    const requiredKey = getHostExtraFilesKeyPath(layout, hostName);
	    if (!fs.existsSync(requiredKey)) {
	      throw new Error(`missing extra-files key: ${requiredKey} (run: clawdlets secrets init)`);
	    }

    const fleetPath = path.join(repoRoot, "infra", "configs", "fleet.nix");
    const bots = (await evalFleetConfig({ repoRoot, fleetFilePath: fleetPath, nixBin })).bots;

	    const tailnetMode = String(hostCfg.tailnet?.mode || "none");

    const requiredSecrets = [
      ...(tailnetMode === "tailscale" ? ["tailscale_auth_key"] : []),
      "admin_password_hash",
      ...bots.map((b) => `discord_token_${b}`),
    ];

	    const extraFilesSecretsDir = getHostExtraFilesSecretsDir(layout, hostName);
	    if (!fs.existsSync(extraFilesSecretsDir)) {
	      throw new Error(`missing extra-files secrets dir: ${extraFilesSecretsDir} (run: clawdlets secrets init)`);
	    }

    for (const secretName of requiredSecrets) {
      const f = path.join(extraFilesSecretsDir, `${secretName}.yaml`);
      if (!fs.existsSync(f)) {
        throw new Error(`missing extra-files secret: ${f} (run: clawdlets secrets init)`);
      }
    }

    const nixosAnywhereArgs = [
      "run",
      "--option",
      "max-jobs",
      "1",
      "--option",
      "cores",
      "1",
      "--option",
      "keep-outputs",
      "false",
      "--option",
      "keep-derivations",
      "false",
      "github:nix-community/nixos-anywhere",
      "--",
      "--option",
      "tarball-ttl",
      "0",
      "--option",
      "accept-flake-config",
      "true",
      "--option",
      "extra-substituters",
      "https://cache.garnix.io",
      "--option",
      "extra-trusted-public-keys",
      "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
      "--build-on-remote",
      "--extra-files",
      extraFiles,
      ...(githubToken ? ["--option", "access-tokens", `github.com=${githubToken}`] : []),
      "--flake",
      flakePinned,
      `root@${ipv4}`,
    ];

    const nixosAnywhereBaseEnv = withFlakesEnv(process.env);
    const nixosAnywhereEnv: NodeJS.ProcessEnv = {
      ...nixosAnywhereBaseEnv,
      NIX_CONFIG: [
        nixosAnywhereBaseEnv.NIX_CONFIG,
        "accept-flake-config = true",
        "extra-substituters = https://cache.garnix.io",
        "extra-trusted-public-keys = cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
        githubToken ? `access-tokens = github.com=${githubToken}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };

    await run(nixBin, nixosAnywhereArgs, {
      cwd: repoRoot,
      env: nixosAnywhereEnv,
      dryRun: args.dryRun,
      redact: [hcloudToken, githubToken].filter(Boolean) as string[],
    });

	    if (!Boolean((args as any)["keep-public-ssh"])) {
	      await applyOpenTofuVars({
	        repoRoot,
	        vars: {
	          hcloudToken,
	          adminCidr,
	          sshPubkeyFile,
	          serverType,
	          publicSsh: false,
	        },
	        nixBin,
	        dryRun: args.dryRun,
        redact: [hcloudToken, githubToken].filter(Boolean) as string[],
      });
    }

    await purgeKnownHosts(ipv4, { dryRun: args.dryRun });
    console.log(`ok: installed; ssh admin@${ipv4}`);
  },
});
