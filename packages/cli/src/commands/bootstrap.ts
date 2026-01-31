import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdlets/core/lib/opentofu";
import { resolveGitRev } from "@clawdlets/core/lib/git";
import { capture, run } from "@clawdlets/core/lib/run";
import { sshCapture } from "@clawdlets/core/lib/ssh-remote";
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "@clawdlets/core/lib/github";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { expandPath } from "@clawdlets/core/lib/path-expand";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets-plan";
import { withFlakesEnv } from "@clawdlets/core/lib/nix-flakes";
import { ClawdletsConfigSchema, getSshExposureMode, getTailnetMode, loadClawdletsConfig, writeClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";
import { resolveBaseFlake } from "@clawdlets/core/lib/base-flake";
import { getHostExtraFilesDir, getHostExtraFilesKeyPath, getHostExtraFilesSecretsDir, getHostOpenTofuDir } from "@clawdlets/core/repo-layout";
import { requireDeployGate } from "../lib/deploy-gate.js";
import { resolveHostNameOrExit } from "@clawdlets/core/lib/host-resolve";
import { extractFirstIpv4, isTailscaleIpv4, normalizeSingleLineOutput } from "@clawdlets/core/lib/host-connectivity";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDurationToMs(raw: string): number | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = String(m[2]).toLowerCase();
  const seconds =
    unit === "s" ? n :
    unit === "m" ? n * 60 :
    unit === "h" ? n * 60 * 60 :
    unit === "d" ? n * 60 * 60 * 24 :
    null;
  if (seconds == null) return null;
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

async function waitForTailscaleIpv4ViaSsh(params: {
  ipv4: string;
  timeoutMs: number;
  pollMs: number;
  repoRoot: string;
}): Promise<string> {
  const startedAt = Date.now();
  const deadline = startedAt + params.timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const raw = await sshCapture(
        `admin@${params.ipv4}`,
        "sh -lc 'command -v tailscale >/dev/null 2>&1 && tailscale ip -4 || true'",
        { cwd: params.repoRoot, timeoutMs: 8_000, maxOutputBytes: 8 * 1024 },
      );
      const normalized = normalizeSingleLineOutput(raw || "");
      const candidate = extractFirstIpv4(normalized || raw || "");
      if (candidate && isTailscaleIpv4(candidate)) return candidate;
      lastError = candidate ? `unexpected IPv4 ${candidate}` : "tailscale ip missing";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(params.pollMs);
  }

  const waited = Math.max(0, Date.now() - startedAt);
  throw new Error(`timed out waiting for tailscale ipv4 after ${waited}ms (last error: ${lastError || "unknown"})`);
}

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
    description: "Provision Hetzner VM + install NixOS (nixos-anywhere or image).",
	  },
	  args: {
	    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
	    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
	    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
	    mode: { type: "string", description: "Bootstrap mode: nixos-anywhere|image.", default: "nixos-anywhere" },
	    flake: { type: "string", description: "Override base flake (default: clawdlets.json baseFlake or git origin)." },
	    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
	    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
	    lockdownAfter: { type: "boolean", description: "After bootstrap, wait for tailnet and remove public SSH (updates config + runs OpenTofu apply).", default: false },
	    lockdownTimeout: { type: "string", description: "Max wait for tailnet health (<n><s|m|h|d>, default 10m).", default: "10m" },
	    lockdownPoll: { type: "string", description: "Tailnet poll interval (<n><s|m|h|d>, default 5s).", default: "5s" },
	    force: { type: "boolean", description: "Skip doctor gate (not recommended).", default: false },
	    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
	  },
	  async run({ args }) {
	    const cwd = process.cwd();
	    const repoRoot = findRepoRoot(cwd);
	    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
	    if (!hostName) return;
	    const { layout, configPath, config: clawdletsConfig } = loadClawdletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
	    const hostCfg = clawdletsConfig.hosts[hostName];
	    if (!hostCfg) throw new Error(`missing host in fleet/clawdlets.json: ${hostName}`);
	    const sshExposureMode = getSshExposureMode(hostCfg);
	    const tailnetMode = getTailnetMode(hostCfg);
	    const lockdownAfter = Boolean((args as any).lockdownAfter);
	    const lockdownTimeoutRaw = String((args as any).lockdownTimeout || "10m").trim() || "10m";
	    const lockdownPollRaw = String((args as any).lockdownPoll || "5s").trim() || "5s";
	    const lockdownTimeoutMs = parseDurationToMs(lockdownTimeoutRaw);
	    if (!lockdownTimeoutMs) throw new Error(`invalid --lockdown-timeout: ${lockdownTimeoutRaw} (expected <n><s|m|h|d>, e.g. 10m)`);
	    const lockdownPollMs = parseDurationToMs(lockdownPollRaw);
	    if (!lockdownPollMs) throw new Error(`invalid --lockdown-poll: ${lockdownPollRaw} (expected <n><s|m|h|d>, e.g. 5s)`);
	    const modeRaw = String((args as any).mode || "nixos-anywhere").trim();
	    if (modeRaw !== "nixos-anywhere" && modeRaw !== "image") {
	      throw new Error(`invalid --mode: ${modeRaw} (expected nixos-anywhere|image)`);
	    }
	    const mode = modeRaw as "nixos-anywhere" | "image";
	    if (lockdownAfter && mode !== "nixos-anywhere") {
	      throw new Error(`--lockdown-after is only supported with --mode nixos-anywhere`);
	    }
	    if (lockdownAfter && tailnetMode !== "tailscale") {
	      throw new Error(`--lockdown-after requires tailnet.mode=tailscale (current: ${tailnetMode})`);
	    }

	    if (Boolean((args as any).force)) {
	      console.error("warn: skipping doctor gate (--force)");
	    } else {
	      if (mode === "nixos-anywhere") {
	        await requireDeployGate({ runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile, host: hostName, scope: "bootstrap", strict: false });
	      } else {
	        console.error("warn: skipping doctor gate for image bootstrap");
	      }
	    }

	    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
	    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
	    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

	    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
	    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");
	    const githubToken = String(deployCreds.values.GITHUB_TOKEN || "").trim();

	    const nixBin = String(deployCreds.values.NIX_BIN || "nix").trim() || "nix";
	    const opentofuDir = getHostOpenTofuDir(layout, hostName);

	    const serverType = String(hostCfg.hetzner.serverType || "").trim();
	    if (!serverType) throw new Error(`missing hetzner.serverType for ${hostName} (set via: clawdlets host set --server-type ...)`);
	    const image = String(hostCfg.hetzner.image || "").trim();
	    const location = String(hostCfg.hetzner.location || "").trim();
	    if (mode === "image" && !image) {
	      throw new Error(`missing hetzner.image for ${hostName} (set via: clawdlets host set --hetzner-image <image_id>)`);
	    }

	    const adminCidr = String(hostCfg.provisioning.adminCidr || "").trim();
	    if (!adminCidr) throw new Error(`missing provisioning.adminCidr for ${hostName} (set via: clawdlets host set --admin-cidr ...)`);

	    const sshPubkeyFileRaw = String(hostCfg.provisioning.sshPubkeyFile || "").trim();
	    if (!sshPubkeyFileRaw) throw new Error(`missing provisioning.sshPubkeyFile for ${hostName} (set via: clawdlets host set --ssh-pubkey-file ...)`);
	    const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
	    const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded) ? sshPubkeyFileExpanded : path.resolve(repoRoot, sshPubkeyFileExpanded);
	    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);

	    if (sshExposureMode === "tailnet") {
	      throw new Error(`sshExposure.mode=tailnet; bootstrap requires public SSH. Set: clawdlets host set --host ${hostName} --ssh-exposure bootstrap`);
	    }

	    await applyOpenTofuVars({
	      opentofuDir,
	      vars: {
          hostName,
	        hcloudToken,
	        adminCidr,
	        adminCidrIsWorldOpen: Boolean(hostCfg.provisioning.adminCidrAllowWorldOpen),
	        sshPubkeyFile,
	        serverType,
	        image,
	        location,
	        sshExposureMode,
	        tailnetMode,
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

    if (mode === "image") {
      console.log("🎉 Bootstrap complete (image mode).");
      console.log(`Host: ${hostName}`);
      console.log(`IPv4: ${ipv4}`);
      console.log(`SSH exposure: ${sshExposureMode}`);
      console.log("");
      console.log("Next:");
      console.log(`1) Set targetHost for deploys:`);
      console.log(`   clawdlets host set --host ${hostName} --target-host admin@${ipv4}`);
      console.log("2) Deploy secrets + system:");
      console.log(`   clawdlets server deploy --host ${hostName} --target-host admin@${ipv4} --manifest deploy/${hostName}/prod/<releaseId>.json`);
      console.log("");
      console.log("After tailnet is healthy, lock down SSH:");
      console.log(`  clawdlets host set --host ${hostName} --ssh-exposure tailnet`);
      console.log(`  clawdlets lockdown --host ${hostName}`);
      return;
    }

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

    const secretsPlan = buildFleetSecretsPlan({ config: clawdletsConfig, hostName });

    const requiredSecrets = [
      ...(tailnetMode === "tailscale" ? ["tailscale_auth_key"] : []),
      "admin_password_hash",
      ...secretsPlan.secretNamesRequired,
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

    const extraSubstituters = hostCfg.cache.substituters.join(" ");
    const extraTrustedPublicKeys = hostCfg.cache.trustedPublicKeys.join(" ");

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
      extraSubstituters,
      "--option",
      "extra-trusted-public-keys",
      extraTrustedPublicKeys,
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
        `extra-substituters = ${extraSubstituters}`,
        `extra-trusted-public-keys = ${extraTrustedPublicKeys}`,
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

    await purgeKnownHosts(ipv4, { dryRun: args.dryRun });

	    let publicSshStatus = "OPEN";

	    if (lockdownAfter) {
	      if (args.dryRun) {
	        console.log("");
	        console.log("dry-run: would wait for tailscale + apply lockdown:");
        console.log(`  ssh admin@${ipv4} 'tailscale ip -4'  # wait for 100.x`);
        console.log(`  set hosts.${hostName}.targetHost = admin@<tailscale-ip>`);
        console.log(`  set hosts.${hostName}.sshExposure.mode = tailnet`);
        console.log(`  clawdlets lockdown --host ${hostName}`);
      } else {
        console.log("");
        console.log(`Waiting for tailnet (timeout ${lockdownTimeoutRaw}, poll ${lockdownPollRaw})...`);
        const tailscaleIpv4 = await waitForTailscaleIpv4ViaSsh({
          ipv4,
          timeoutMs: lockdownTimeoutMs,
          pollMs: lockdownPollMs,
          repoRoot,
        });
        console.log(`Tailnet IPv4: ${tailscaleIpv4}`);

        const nextHostCfg = structuredClone(hostCfg) as any;
        nextHostCfg.targetHost = `admin@${tailscaleIpv4}`;
        nextHostCfg.sshExposure = { ...(nextHostCfg.sshExposure || {}), mode: "tailnet" };
        nextHostCfg.tailnet = { ...(nextHostCfg.tailnet || {}), mode: "tailscale" };
        const nextConfig = ClawdletsConfigSchema.parse({
          ...clawdletsConfig,
          hosts: { ...clawdletsConfig.hosts, [hostName]: nextHostCfg },
        });
        await writeClawdletsConfig({ configPath, config: nextConfig });
        console.log(`ok: updated fleet/clawdlets.json (targetHost + sshExposure=tailnet)`);

        await applyOpenTofuVars({
          opentofuDir,
          vars: {
            hostName,
            hcloudToken,
            adminCidr,
            adminCidrIsWorldOpen: Boolean(hostCfg.provisioning.adminCidrAllowWorldOpen),
            sshPubkeyFile,
            serverType,
            image,
            location,
            sshExposureMode: "tailnet",
            tailnetMode,
          },
          nixBin,
          dryRun: args.dryRun,
          redact: [hcloudToken, githubToken].filter(Boolean) as string[],
        });

        publicSshStatus = "LOCKED DOWN";
      }
    }

    const effectiveSshExposureMode = lockdownAfter && !args.dryRun ? "tailnet" : sshExposureMode;

    console.log("🎉 Bootstrap complete.");
    console.log(`Host: ${hostName}`);
    console.log(`IPv4: ${ipv4}`);
    console.log(`SSH exposure: ${effectiveSshExposureMode}`);
    console.log(`Public SSH (22): ${publicSshStatus}`);

    if (!lockdownAfter) {
      console.log("");
      console.log("⚠ SSH WILL REMAIN OPEN until you switch to tailnet and run lockdown:");
      console.log(`  clawdlets host set --host ${hostName} --ssh-exposure tailnet`);
      console.log(`  clawdlets lockdown --host ${hostName}`);
    }

    if (tailnetMode === "tailscale") {
      console.log("");
      console.log("Next (tailscale):");
      if (lockdownAfter) {
        console.log(`1) Verify access via tailnet (targetHost updated):`);
        console.log(`   ssh admin@<tailscale-ip> 'hostname; uptime'`);
        console.log("2) Redeploy so NixOS firewall also becomes tailnet-only:");
        console.log(`   clawdlets server deploy --host ${hostName}`);
        console.log("3) Optional checks:");
        console.log("   clawdlets server audit --host " + hostName);
      } else {
        console.log(`1) Wait for the host to appear in Tailscale, then copy its 100.x IP.`);
        console.log("   tailscale status  # look for the 100.x address");
        console.log(`2) Set future SSH target to tailnet:`);
        console.log(`   clawdlets host set --host ${hostName} --target-host admin@<tailscale-ip>`);
        console.log("3) Verify access:");
        console.log("   ssh admin@<tailscale-ip> 'hostname; uptime'");
        console.log("4) Switch SSH exposure to tailnet and lock down:");
        console.log(`   clawdlets host set --host ${hostName} --ssh-exposure tailnet`);
        console.log(`   clawdlets lockdown --host ${hostName}`);
        console.log("5) Optional checks:");
        console.log("   clawdlets server audit --host " + hostName);
      }
	    } else {
      console.log("");
      console.log("Notes:");
      console.log(`- SSH exposure is ${sshExposureMode}.`);
      console.log("- If you want tailnet-only SSH, set tailnet.mode=tailscale, verify access, then:");
      console.log(`  clawdlets host set --host ${hostName} --ssh-exposure tailnet`);
	      console.log(`  clawdlets lockdown --host ${hostName}`);
	    }
	  },
	});
