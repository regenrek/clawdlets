import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { applyTerraformVars } from "@clawdbot/clawdlets-core/lib/terraform";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { capture, run } from "@clawdbot/clawdlets-core/lib/run";
import { loadStack, loadStackEnv, resolveStackBaseFlake } from "@clawdbot/clawdlets-core/stack";
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "@clawdbot/clawdlets-core/lib/github";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { evalFleetConfig } from "@clawdbot/clawdlets-core/lib/fleet-nix-eval";
import { withFlakesEnv } from "@clawdbot/clawdlets-core/lib/nix-flakes";
import { requireDeployGate } from "../lib/deploy-gate.js";

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
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    flake: { type: "string", description: "Override base flake (default: stack.base.flake)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    await requireDeployGate({ stackDir: args.stackDir, host: hostName, scope: "deploy", strict: false });

    const envLoaded = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    const hcloudToken = String(envLoaded.env.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (stack env)");
    const githubToken = String(envLoaded.env.GITHUB_TOKEN || "").trim();

    const repoRoot = layout.repoRoot;
    const terraformDir = path.join(repoRoot, "infra", "terraform");
    const nixBin = envLoaded.env.NIX_BIN || "nix";
    const sshPubkeyFile = expandPath(host.terraform.sshPubkeyFile);

    await applyTerraformVars({
      repoRoot,
      vars: {
        hcloudToken,
        adminCidr: host.terraform.adminCidr,
        sshPubkeyFile,
        serverType: host.hetzner.serverType,
        bootstrapSsh: true,
      },
      nixBin,
      dryRun: args.dryRun,
      redact: [hcloudToken, githubToken].filter(Boolean) as string[],
    });

    const terraformEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HCLOUD_TOKEN: hcloudToken,
      ADMIN_CIDR: host.terraform.adminCidr,
      SSH_PUBKEY_FILE: sshPubkeyFile,
      SERVER_TYPE: host.hetzner.serverType,
      NIXPKGS_ALLOW_UNFREE: "1",
    };
    const terraformEnvWithFlakes = withFlakesEnv(terraformEnv);

    const ipv4 = args.dryRun
      ? "<terraform-output:ipv4>"
      : await capture(
          nixBin,
          ["run", "--impure", "nixpkgs#terraform", "--", "output", "-raw", "ipv4"],
          { cwd: terraformDir, env: terraformEnvWithFlakes, dryRun: args.dryRun },
        );

    console.log(`Target IPv4: ${ipv4}`);
    await purgeKnownHosts(ipv4, { dryRun: args.dryRun });

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
        throw new Error(`base flake repo appears private (404). Set GITHUB_TOKEN in stack env and retry.`);
      }
      if (check.ok && check.status === "unauthorized") {
        throw new Error(`GITHUB_TOKEN rejected by GitHub (401).`);
      }
    }

    const extraFiles = path.join(layout.stackDir, "extra-files", hostName);
    const requiredKey = path.join(extraFiles, "var", "lib", "sops-nix", "key.txt");
    if (!fs.existsSync(requiredKey)) {
      throw new Error(`missing extra-files key: ${requiredKey} (run: clawdlets secrets init --host ${hostName})`);
    }

    const fleetPath = path.join(repoRoot, "infra", "configs", "fleet.nix");
    const bots = (await evalFleetConfig({ repoRoot, fleetFilePath: fleetPath, nixBin })).bots;
    const requiredSecrets = ["wg_private_key", "admin_password_hash", ...bots.map((b) => `discord_token_${b}`)];

    const remoteSecretsDir = String(host.secrets.remoteDir || "").trim();
    if (!remoteSecretsDir) throw new Error(`missing stack host secrets.remoteDir for ${hostName}`);
    const extraFilesSecretsDir = path.join(extraFiles, remoteSecretsDir.replace(/^\/+/, ""));
    if (!fs.existsSync(extraFilesSecretsDir)) {
      throw new Error(`missing extra-files secrets dir: ${extraFilesSecretsDir} (run: clawdlets secrets init --host ${hostName})`);
    }

    for (const secretName of requiredSecrets) {
      const f = path.join(extraFilesSecretsDir, `${secretName}.yaml`);
      if (!fs.existsSync(f)) {
        throw new Error(`missing extra-files secret: ${f} (run: clawdlets secrets init --host ${hostName})`);
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

    await purgeKnownHosts(ipv4, { dryRun: args.dryRun });
    console.log(`ok: installed; ssh admin@${ipv4}`);
  },
});
