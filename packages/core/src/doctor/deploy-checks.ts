import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { RepoLayout } from "../repo-layout.js";
import {
  getHostEncryptedAgeKeyFile,
  getHostExtraFilesDir,
  getHostExtraFilesKeyPath,
  getHostRemoteSecretsDir,
  getHostSecretsDir,
} from "../repo-layout.js";
import { sopsPathRegexForDirFiles } from "../lib/sops-config.js";
import { relativePathForSopsRule } from "../lib/sops-path.js";
import { validateHostSecretsYamlFiles } from "../lib/secrets-policy.js";
import { capture } from "../lib/run.js";
import { looksLikeSshKeyContents, normalizeSshPublicKey } from "../lib/ssh.js";
import { loadClawdletsConfig } from "../lib/clawdlets-config.js";
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "../lib/github.js";
import { tryGetOriginFlake } from "../lib/git.js";
import { expandPath } from "../lib/path-expand.js";
import { resolveBaseFlake } from "../lib/base-flake.js";
import type { DoctorPush } from "./types.js";

export async function addDeployChecks(params: {
  cwd: string;
  repoRoot: string;
  layout: RepoLayout;
  host: string;
  nixBin: string;
  hcloudToken?: string;
  sopsAgeKeyFile?: string;
  githubToken?: string;
  fleetBots: string[] | null;
  push: DoctorPush;
}): Promise<void> {
  const host = params.host.trim() || "clawdbot-fleet-host";

  try {
    const v = await capture(params.nixBin, ["--version"], { cwd: params.repoRoot });
    params.push({ scope: "deploy", status: "ok", label: "nix", detail: v });
  } catch {
    params.push({
      scope: "deploy",
      status: "missing",
      label: "nix",
      detail: `(${params.nixBin} not found; install Nix first)`,
    });
  }

  params.push({
    scope: "deploy",
    status: params.hcloudToken ? "ok" : "missing",
    label: "HCLOUD_TOKEN",
    detail: params.hcloudToken ? "(set)" : undefined,
  });

  if (params.sopsAgeKeyFile) {
    params.push({
      scope: "deploy",
      status: fs.existsSync(params.sopsAgeKeyFile) ? "ok" : "missing",
      label: "SOPS_AGE_KEY_FILE",
      detail: params.sopsAgeKeyFile,
    });
  } else {
    const operatorKeyExists =
      fs.existsSync(params.layout.localOperatorKeysDir) &&
      fs.readdirSync(params.layout.localOperatorKeysDir, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith(".agekey"));
    params.push({
      scope: "deploy",
      status: operatorKeyExists ? "ok" : "warn",
      label: "SOPS_AGE_KEY_FILE",
      detail: operatorKeyExists ? "(using local operator key(s))" : "(not set; sops edit/decrypt may fail)",
    });
  }

  const extraFilesDir = getHostExtraFilesDir(params.layout, host);
  const extraFilesKey = getHostExtraFilesKeyPath(params.layout, host);

  params.push({
    scope: "deploy",
    status: fs.existsSync(extraFilesDir) ? "ok" : "missing",
    label: "nixos-anywhere extra-files dir",
    detail: extraFilesDir,
  });

  params.push({
    scope: "deploy",
    status: fs.existsSync(extraFilesKey) ? "ok" : "missing",
    label: "sops-nix age key (extra-files)",
    detail: extraFilesKey,
  });

  params.push({
    scope: "deploy",
    status: fs.existsSync(params.layout.sopsConfigPath) ? "ok" : "missing",
    label: "sops config",
    detail: params.layout.sopsConfigPath,
  });

  let clawdletsCfg: any = null;
  let clawdletsHostCfg: any = null;
  try {
    const loaded = loadClawdletsConfig({ repoRoot: params.repoRoot });
    clawdletsCfg = loaded.config as any;
    clawdletsHostCfg = (loaded.config.hosts as any)?.[host] ?? null;
  } catch {}

  if (!clawdletsHostCfg) {
    params.push({ scope: "deploy", status: "warn", label: "host config", detail: `(missing host in infra/configs/clawdlets.json: ${host})` });
  } else {
    params.push({
      scope: "deploy",
      status: clawdletsHostCfg.enable ? "ok" : "warn",
      label: "services.clawdbotFleet.enable",
      detail: clawdletsHostCfg.enable ? "(true)" : "(false; host will install but fleet services/VPN won't run until enabled)",
    });

    {
      const publicSsh = Boolean(clawdletsHostCfg.publicSsh?.enable);
      params.push({
        scope: "deploy",
        status: publicSsh ? "missing" : "ok",
        label: "publicSsh",
        detail: publicSsh ? "(enabled; public SSH open)" : "(disabled)",
      });
    }

    {
      const provisioning = Boolean(clawdletsHostCfg.provisioning?.enable);
      params.push({
        scope: "deploy",
        status: provisioning ? "warn" : "ok",
        label: "provisioning",
        detail: provisioning ? "(enabled)" : "(disabled)",
      });
    }

    const mode = String(clawdletsHostCfg.tailnet?.mode || "none");
    if (mode === "none") {
      params.push({ scope: "deploy", status: "warn", label: "tailnet configured", detail: "(tailnet.mode=none)" });
    } else if (mode === "tailscale") {
      params.push({ scope: "deploy", status: "ok", label: "tailnet configured", detail: "(tailscale)" });
    } else {
      params.push({ scope: "deploy", status: "warn", label: "tailnet configured", detail: `(unknown: ${mode})` });
    }
  }

  if (clawdletsCfg) {
    const baseResolved = await resolveBaseFlake({ repoRoot: params.repoRoot, config: clawdletsCfg });
    params.push({
      scope: "deploy",
      status: baseResolved.flake ? "ok" : "warn",
      label: "base flake",
      detail: baseResolved.flake ?? "(unset; inferred from origin if present)",
    });
  }

  if (clawdletsHostCfg) {
    params.push({
      scope: "deploy",
      status: clawdletsHostCfg.targetHost ? "ok" : "warn",
      label: "targetHost",
      detail: clawdletsHostCfg.targetHost || "(unset; required for lockdown/server ops)",
    });

    const serverType = String(clawdletsHostCfg.hetzner?.serverType || "").trim();
    params.push({
      scope: "deploy",
      status: serverType ? "ok" : "missing",
      label: "hetzner.serverType",
      detail: serverType || "(unset)",
    });

    const adminCidr = String(clawdletsHostCfg.opentofu?.adminCidr || "").trim();
    params.push({
      scope: "deploy",
      status: adminCidr ? "ok" : "missing",
      label: "opentofu.adminCidr",
      detail: adminCidr || "(unset)",
    });

    {
      const raw = String(clawdletsHostCfg.opentofu?.sshPubkeyFile || "").trim();
      if (!raw) {
        params.push({ scope: "deploy", status: "missing", label: "opentofu ssh pubkey file", detail: "(unset)" });
      } else if (looksLikeSshKeyContents(raw)) {
        params.push({
          scope: "deploy",
          status: "missing",
          label: "opentofu ssh pubkey file",
          detail: "(must be a path, not key contents)",
        });
      } else {
        const expanded = expandPath(raw);
        const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.repoRoot, expanded);
        params.push({ scope: "deploy", status: fs.existsSync(abs) ? "ok" : "missing", label: "opentofu ssh pubkey file", detail: abs });

        const sshKey = fs.existsSync(abs) ? normalizeSshPublicKey(fs.readFileSync(abs, "utf8")) : null;
        if (sshKey) {
          const authorized = (clawdletsHostCfg.sshAuthorizedKeys || []) as string[];
          const has = authorized.some((k) => normalizeSshPublicKey(k) === sshKey);
          params.push({
            scope: "deploy",
            status: has ? "ok" : "warn",
            label: "admin authorizedKeys includes ssh pubkey file",
            detail: has ? "(ok)" : `(add your key via: clawdlets host set --add-ssh-key-file ${raw})`,
          });
        }
      }
    }

    const secretsLocalDir = getHostSecretsDir(params.layout, host);
    const integrity = validateHostSecretsYamlFiles({ secretsDir: secretsLocalDir });
    if (!integrity.ok) {
      const first = integrity.violations[0]!;
      params.push({
        scope: "deploy",
        status: "missing",
        label: "secrets integrity",
        detail: `${path.relative(params.repoRoot, first.filePath)}:${first.line ?? 1} ${first.message}`,
      });
    } else {
      params.push({ scope: "deploy", status: "ok", label: "secrets integrity", detail: "(one secret per file; key matches filename)" });
    }

    const hostKeyFile = getHostEncryptedAgeKeyFile(params.layout, host);
    params.push({
      scope: "deploy",
      status: fs.existsSync(hostKeyFile) ? "ok" : "missing",
      label: "host sops-nix age key (encrypted)",
      detail: hostKeyFile,
    });

    params.push({
      scope: "deploy",
      status: "ok",
      label: "remote secrets dir",
      detail: getHostRemoteSecretsDir(host),
    });

    if (params.fleetBots && params.fleetBots.length > 0) {
      const tailnetMode = String(clawdletsHostCfg?.tailnet?.mode || "none");
      const required = [
        ...(tailnetMode === "tailscale" ? ["tailscale_auth_key"] : []),
        "admin_password_hash",
        ...params.fleetBots.map((b) => `discord_token_${b}`),
      ];
      for (const secretName of required) {
        const f = path.join(secretsLocalDir, `${secretName}.yaml`);
        params.push({
          scope: "deploy",
          status: fs.existsSync(f) ? "ok" : "missing",
          label: `secret: ${secretName}`,
          detail: fs.existsSync(f) ? undefined : f,
        });
      }
    } else {
      params.push({ scope: "deploy", status: "warn", label: "required secrets", detail: "(fleet bots list missing; cannot validate discord_token_<bot> secrets)" });
    }

    if (fs.existsSync(params.layout.sopsConfigPath)) {
      const sopsText = fs.readFileSync(params.layout.sopsConfigPath, "utf8");
      let parsed: { creation_rules?: unknown } | null = null;
      try {
        parsed = (YAML.parse(sopsText) as { creation_rules?: unknown }) || {};
      } catch {
        params.push({ scope: "deploy", status: "warn", label: "sops config parse", detail: "(invalid YAML)" });
        parsed = null;
      }

      if (parsed) {
        const rules = Array.isArray((parsed as { creation_rules?: unknown }).creation_rules)
          ? ((parsed as { creation_rules: unknown[] }).creation_rules as Array<{ path_regex?: unknown }>)
          : [];

        const configDir = path.dirname(params.layout.sopsConfigPath);
        let relSecretsDir: string;
        try {
          relSecretsDir = relativePathForSopsRule({ fromDir: configDir, toPath: secretsLocalDir, label: "host secrets dir" });
        } catch (e) {
          params.push({ scope: "deploy", status: "warn", label: "sops creation rule", detail: String((e as Error)?.message || e) });
          relSecretsDir = "";
        }

        if (relSecretsDir) {
          const expected = sopsPathRegexForDirFiles(relSecretsDir, "yaml");
          const hasRule = rules.some((r) => String(r?.path_regex || "") === expected);
          params.push({
            scope: "deploy",
            status: hasRule ? "ok" : "missing",
            label: "sops creation rule",
            detail: hasRule ? `(${relSecretsDir}/*.yaml)` : `(missing rule for ${relSecretsDir}/*.yaml)`,
          });
        }
      }
    }
  }

  const flakeResolved = clawdletsCfg ? (await resolveBaseFlake({ repoRoot: params.repoRoot, config: clawdletsCfg })).flake : null;
  const flakeBase = flakeResolved || (await tryGetOriginFlake(params.repoRoot)) || params.repoRoot;
  const githubRepo = tryParseGithubFlakeUri(flakeBase);

  if (!githubRepo) {
    params.push({
      scope: "deploy",
      status: "ok",
      label: "GITHUB_TOKEN",
      detail: "(not needed; origin flake is not github:...)",
    });
    return;
  }

  if (params.githubToken) {
    const check = await checkGithubRepoVisibility({
      owner: githubRepo.owner,
      repo: githubRepo.repo,
      token: params.githubToken,
    });

    if (check.ok && check.status === "public") {
      params.push({
        scope: "deploy",
        status: "ok",
        label: "GITHUB_TOKEN",
        detail: `(set; has access to ${githubRepo.owner}/${githubRepo.repo})`,
      });
    } else if (check.ok && check.status === "unauthorized") {
      params.push({
        scope: "deploy",
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: "(invalid/expired; GitHub API returned 401)",
      });
    } else if (check.ok && check.status === "private-or-missing") {
      params.push({
        scope: "deploy",
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: `(set but no access; GitHub API returned 404 for ${githubRepo.owner}/${githubRepo.repo})`,
      });
    } else if (check.ok && check.status === "rate-limited") {
      params.push({
        scope: "deploy",
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(set; GitHub API rate-limited during verification)",
      });
    } else {
      params.push({
        scope: "deploy",
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(set; could not verify against GitHub API)",
      });
    }
    return;
  }

  const check = await checkGithubRepoVisibility({
    owner: githubRepo.owner,
    repo: githubRepo.repo,
  });

  if (check.ok && check.status === "public") {
    params.push({
      scope: "deploy",
      status: "ok",
      label: "GITHUB_TOKEN",
      detail: `(optional; ${githubRepo.owner}/${githubRepo.repo} is public)`,
    });
  } else if (check.ok && check.status === "private-or-missing") {
    params.push({
      scope: "deploy",
      status: "missing",
      label: "GITHUB_TOKEN",
      detail: `(required; ${githubRepo.owner}/${githubRepo.repo} is private)`,
    });
  } else if (check.ok && check.status === "rate-limited") {
    params.push({
      scope: "deploy",
      status: "warn",
      label: "GITHUB_TOKEN",
      detail: "(unknown; GitHub API rate-limited; if bootstrap fails with 404, set token)",
    });
  } else {
    params.push({
      scope: "deploy",
      status: "warn",
      label: "GITHUB_TOKEN",
      detail: "(unknown; could not verify repo visibility; if bootstrap fails with 404, set token)",
    });
  }
}
