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
import { getHostAgeKeySopsCreationRulePathRegex, getHostAgeKeySopsCreationRulePathSuffix, getHostSecretsSopsCreationRulePathRegex, getHostSecretsSopsCreationRulePathSuffix } from "../lib/sops-rules.js";
import { validateHostSecretsYamlFiles } from "../lib/secrets-policy.js";
import { buildFleetEnvSecretsPlan } from "../lib/fleet-env-secrets.js";
import { capture } from "../lib/run.js";
import { looksLikeSshKeyContents, normalizeSshPublicKey } from "../lib/ssh.js";
import type { DoctorCheck } from "./types.js";
import {
  getSshExposureMode,
  isPublicSshExposure,
  loadClawdletsConfig,
  type ClawdletsConfig,
  type ClawdletsHostConfig,
} from "../lib/clawdlets-config.js";
import { isPlaceholderSecretValue } from "../lib/secrets-init.js";
import { getRecommendedSecretNameForEnvVar } from "../lib/llm-provider-env.js";
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "../lib/github.js";
import { tryGetOriginFlake } from "../lib/git.js";
import { expandPath } from "../lib/path-expand.js";
import { resolveBaseFlake } from "../lib/base-flake.js";
import { sopsDecryptYamlFile } from "../lib/sops.js";
import { readYamlScalarFromMapping } from "../lib/yaml-scalar.js";
import type { DoctorPush } from "./types.js";

function routingChannelsFromOverride(v: unknown): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  const channels = (v as any).channels as unknown;
  if (!Array.isArray(channels)) return [];
  const xs = channels.map((x) => String(x ?? "").trim()).filter(Boolean);
  return Array.from(new Set(xs));
}

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
  skipGithubTokenCheck?: boolean;
  scope: "bootstrap" | "server-deploy";
}): Promise<void> {
  const host = params.host.trim() || "clawdbot-fleet-host";
  const scope = params.scope;
  const push = (c: Omit<DoctorCheck, "scope">) =>
    params.push({ scope, ...c });
  const isBootstrap = scope === "bootstrap";
  const isServerDeploy = scope === "server-deploy";

  try {
    const v = await capture(params.nixBin, ["--version"], { cwd: params.repoRoot });
    push({ status: "ok", label: "nix", detail: v });
  } catch {
    push({
      status: "missing",
      label: "nix",
      detail: `(${params.nixBin} not found; install Nix first)`,
    });
  }

  if (isBootstrap) {
    push({
      status: params.hcloudToken ? "ok" : "missing",
      label: "HCLOUD_TOKEN",
      detail: params.hcloudToken ? "(set)" : "(set in .clawdlets/env or env var; run: clawdlets env init)",
    });
  }

  if (params.sopsAgeKeyFile) {
    push({
      status: fs.existsSync(params.sopsAgeKeyFile) ? "ok" : "missing",
      label: "SOPS_AGE_KEY_FILE",
      detail: params.sopsAgeKeyFile,
    });
  } else {
    const operatorKeyExists =
      fs.existsSync(params.layout.localOperatorKeysDir) &&
      fs.readdirSync(params.layout.localOperatorKeysDir, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith(".agekey"));
    push({
      status: operatorKeyExists ? "ok" : "warn",
      label: "SOPS_AGE_KEY_FILE",
      detail: operatorKeyExists ? "(using local operator key(s))" : "(not set; sops edit/decrypt may fail)",
    });
  }

  const extraFilesDir = getHostExtraFilesDir(params.layout, host);
  const extraFilesKey = getHostExtraFilesKeyPath(params.layout, host);

  if (isBootstrap) {
    push({
      status: fs.existsSync(extraFilesDir) ? "ok" : "missing",
      label: "nixos-anywhere extra-files dir",
      detail: extraFilesDir,
    });

    push({
      status: fs.existsSync(extraFilesKey) ? "ok" : "missing",
      label: "sops-nix age key (extra-files)",
      detail: extraFilesKey,
    });
  }

  push({
    status: fs.existsSync(params.layout.sopsConfigPath) ? "ok" : "missing",
    label: "sops config",
    detail: params.layout.sopsConfigPath,
  });

  let clawdletsCfg: ClawdletsConfig | null = null;
  let clawdletsHostCfg: ClawdletsHostConfig | null = null;
  let clawdletsConfigError: string | null = null;
  try {
    const loaded = loadClawdletsConfig({ repoRoot: params.repoRoot });
    clawdletsCfg = loaded.config;
    clawdletsHostCfg = loaded.config.hosts?.[host] ?? null;
  } catch (err) {
    clawdletsConfigError = String((err as Error)?.message || err);
  }

  if (clawdletsConfigError) {
    push({
      status: "warn",
      label: "clawdlets config",
      detail: clawdletsConfigError,
    });
  }

  if (!clawdletsConfigError && !clawdletsHostCfg) {
    push({ status: "warn", label: "host config", detail: `(missing host in fleet/clawdlets.json: ${host})` });
  } else if (clawdletsHostCfg) {
    push({
      status: clawdletsHostCfg.enable ? "ok" : "warn",
      label: "services.clawdbotFleet.enable",
      detail: clawdletsHostCfg.enable ? "(true)" : "(false; host will install but fleet services/VPN won't run until enabled)",
    });

    {
      const mode = getSshExposureMode(clawdletsHostCfg);
      const isPublic = isPublicSshExposure(mode);
      push({
        status: isPublic ? "warn" : "ok",
        label: "sshExposure",
        detail: isPublic ? `(mode=${mode}; public SSH allowed)` : "(mode=tailnet)",
      });
    }

    const mode = String(clawdletsHostCfg.tailnet?.mode || "none");
    if (mode === "none") {
      push({ status: "warn", label: "tailnet configured", detail: "(tailnet.mode=none)" });
    } else if (mode === "tailscale") {
      push({ status: "ok", label: "tailnet configured", detail: "(tailscale)" });
    } else {
      push({ status: "warn", label: "tailnet configured", detail: `(unknown: ${mode})` });
    }
  }

  if (clawdletsCfg) {
    const baseResolved = await resolveBaseFlake({ repoRoot: params.repoRoot, config: clawdletsCfg });
    push({
      status: baseResolved.flake ? "ok" : "warn",
      label: "base flake",
      detail: baseResolved.flake ?? "(unset; inferred from origin if present)",
    });

    {
      const bots = Array.isArray((clawdletsCfg as any).fleet?.bots) ? ((clawdletsCfg as any).fleet.bots as unknown[]) : [];
      const botIds = bots.map((b) => String(b ?? "").trim()).filter(Boolean);

      const guildId = String((clawdletsCfg as any).fleet?.guildId || "").trim();
      const routingOverridesRaw = (clawdletsCfg as any).fleet?.routingOverrides;
      const routingOverrides =
        routingOverridesRaw && typeof routingOverridesRaw === "object" && !Array.isArray(routingOverridesRaw) ? (routingOverridesRaw as Record<string, unknown>) : {};

      if (botIds.length > 0) {
        const botsWithoutChannels = botIds.filter((b) => routingChannelsFromOverride(routingOverrides[b]).length === 0);

        const missingGuildId = !guildId;
        const missingAllChannels = botsWithoutChannels.length === botIds.length;
        const someBotsMissing = botsWithoutChannels.length > 0 && botsWithoutChannels.length < botIds.length;

        let status: "ok" | "warn" | "missing" = "ok";
        if (missingGuildId || missingAllChannels) status = "missing";
        else if (someBotsMissing) status = "warn";

        const detailParts: string[] = [];
        if (missingGuildId) detailParts.push(`guildId unset (set: clawdlets config set --path fleet.guildId --value <guild_id>)`);
        if (missingAllChannels) {
          detailParts.push(
            `routing.channels empty for all bots (set: clawdlets config set --path fleet.routingOverrides.<bot>.channels --value-json '[\"bots\"]')`,
          );
        } else if (someBotsMissing) {
          detailParts.push(
            `routing.channels empty for: ${botsWithoutChannels.slice(0, 6).join(", ")}${botsWithoutChannels.length > 6 ? ` (+${botsWithoutChannels.length - 6})` : ""}`,
          );
        } else {
          detailParts.push("(ok)");
        }

        push({
          status,
          label: "discord routing",
          detail: detailParts.join("; "),
        });
      }
    }
  }

  if (clawdletsHostCfg) {
    if (isServerDeploy) {
      push({
        status: clawdletsHostCfg.targetHost ? "ok" : "warn",
        label: "targetHost",
        detail: clawdletsHostCfg.targetHost || "(unset; required for lockdown/server ops)",
      });
    }

    if (isBootstrap) {
      const serverType = String(clawdletsHostCfg.hetzner?.serverType || "").trim();
      push({
        status: serverType ? "ok" : "missing",
        label: "hetzner.serverType",
        detail: serverType || "(unset)",
      });

      const adminCidr = String(clawdletsHostCfg.opentofu?.adminCidr || "").trim();
      push({
        status: adminCidr ? "ok" : "missing",
        label: "opentofu.adminCidr",
        detail: adminCidr || "(unset)",
      });

      {
        const raw = String(clawdletsHostCfg.opentofu?.sshPubkeyFile || "").trim();
        if (!raw) {
          push({ status: "missing", label: "opentofu ssh pubkey file", detail: "(unset)" });
        } else if (looksLikeSshKeyContents(raw)) {
          push({
            status: "missing",
            label: "opentofu ssh pubkey file",
            detail: "(must be a path, not key contents)",
          });
        } else {
          const expanded = expandPath(raw);
          const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.repoRoot, expanded);
          push({ status: fs.existsSync(abs) ? "ok" : "missing", label: "opentofu ssh pubkey file", detail: abs });

          const sshKey = fs.existsSync(abs) ? normalizeSshPublicKey(fs.readFileSync(abs, "utf8")) : null;
          if (sshKey) {
            const authorized = (clawdletsHostCfg.sshAuthorizedKeys || []) as string[];
            const has = authorized.some((k) => normalizeSshPublicKey(k) === sshKey);
            push({
              status: has ? "ok" : "warn",
              label: "admin authorizedKeys includes ssh pubkey file",
              detail: has ? "(ok)" : `(add your key via: clawdlets host set --add-ssh-key-file ${raw})`,
            });
          }
        }
      }
    }

    const secretsLocalDir = getHostSecretsDir(params.layout, host);
    const integrity = validateHostSecretsYamlFiles({ secretsDir: secretsLocalDir });
    if (!integrity.ok) {
      const first = integrity.violations[0]!;
      push({
        status: "missing",
        label: "secrets integrity",
        detail: `${path.relative(params.repoRoot, first.filePath)}:${first.line ?? 1} ${first.message}`,
      });
    } else {
      push({ status: "ok", label: "secrets integrity", detail: "(one secret per file; key matches filename)" });
    }

    const hostKeyFile = getHostEncryptedAgeKeyFile(params.layout, host);
    push({
      status: fs.existsSync(hostKeyFile) ? "ok" : "missing",
      label: "host sops-nix age key (encrypted)",
      detail: hostKeyFile,
    });

    push({
      status: "ok",
      label: "remote secrets dir",
      detail: getHostRemoteSecretsDir(host),
    });

    let envPlan: ReturnType<typeof buildFleetEnvSecretsPlan> | null = null;
    try {
      if (clawdletsCfg) envPlan = buildFleetEnvSecretsPlan({ config: clawdletsCfg as any, hostName: host });
    } catch (e) {
      push({ status: "warn", label: "envSecrets plan", detail: String((e as Error)?.message || e) });
      envPlan = null;
    }

    if (envPlan && envPlan.missingEnvSecretMappings.length > 0) {
      for (const m of envPlan.missingEnvSecretMappings.slice(0, 10)) {
        const rec = getRecommendedSecretNameForEnvVar(m.envVar);
        push({
          status: "missing",
          label: `envSecrets mapping: ${m.envVar}`,
          detail: `missing for bot=${m.bot} (model=${m.model}); set: clawdlets config set --path fleet.envSecrets.${m.envVar} --value ${rec || "<secret_name>"}`,
        });
      }
      if (envPlan.missingEnvSecretMappings.length > 10) {
        push({
          status: "missing",
          label: "envSecrets mapping",
          detail: `(+${envPlan.missingEnvSecretMappings.length - 10} more missing mappings)`,
        });
      }
    }

    const botsForSecrets = envPlan?.bots?.length ? envPlan.bots : params.fleetBots || [];
    const envSecretsForHost = envPlan?.secretNamesAll || [];

    if (botsForSecrets.length > 0) {
      const tailnetMode = String(clawdletsHostCfg?.tailnet?.mode || "none");
      const required = Array.from(new Set([
        ...(tailnetMode === "tailscale" ? ["tailscale_auth_key"] : []),
        "admin_password_hash",
        ...envSecretsForHost,
        ...botsForSecrets.map((b) => `discord_token_${b}`),
      ]));
      for (const secretName of required) {
        const f = path.join(secretsLocalDir, `${secretName}.yaml`);
        push({
          status: fs.existsSync(f) ? "ok" : "missing",
          label: `secret: ${secretName}`,
          detail: fs.existsSync(f) ? undefined : f,
        });
      }
    } else {
      push({ status: "warn", label: "required secrets", detail: "(fleet bots list missing; cannot validate discord_token_<bot> secrets)" });
    }

    if (envPlan && envPlan.secretNamesRequired.length > 0 && params.sopsAgeKeyFile && fs.existsSync(params.sopsAgeKeyFile)) {
      const nix = { nixBin: params.nixBin, cwd: params.repoRoot, dryRun: false, env: process.env } as const;
      for (const secretName of envPlan.secretNamesRequired) {
        const filePath = path.join(secretsLocalDir, `${secretName}.yaml`);
        if (!fs.existsSync(filePath)) continue;
        try {
          const decrypted = await sopsDecryptYamlFile({
            filePath,
            configPath: params.layout.sopsConfigPath,
            ageKeyFile: params.sopsAgeKeyFile,
            nix,
          });
          const v = readYamlScalarFromMapping({ yamlText: decrypted, key: secretName }) || "";
          const value = v.trim();
          if (!value) {
            push({ status: "missing", label: `secret value: ${secretName}`, detail: "(empty)" });
            continue;
          }
          if (value === "<OPTIONAL>" || isPlaceholderSecretValue(value)) {
            push({ status: "missing", label: `secret value: ${secretName}`, detail: `(placeholder: ${value})` });
            continue;
          }
          push({ status: "ok", label: `secret value: ${secretName}` });
        } catch (e) {
          push({ status: "warn", label: `secret value: ${secretName}`, detail: String((e as Error)?.message || e) });
        }
      }
    } else if (envPlan && envPlan.secretNamesRequired.length > 0) {
      push({
        status: "warn",
        label: "LLM API keys",
        detail: "(set SOPS_AGE_KEY_FILE to verify required key values are not placeholders)",
      });
    }

    if (fs.existsSync(params.layout.sopsConfigPath)) {
      const sopsText = fs.readFileSync(params.layout.sopsConfigPath, "utf8");
      let parsed: { creation_rules?: unknown } | null = null;
      try {
        parsed = (YAML.parse(sopsText) as { creation_rules?: unknown }) || {};
      } catch {
        push({ status: "warn", label: "sops config parse", detail: "(invalid YAML)" });
        parsed = null;
      }

      if (parsed) {
        const rules = Array.isArray((parsed as { creation_rules?: unknown }).creation_rules)
          ? ((parsed as { creation_rules: unknown[] }).creation_rules as Array<{ path_regex?: unknown }>)
          : [];

        const checkRule = (label: string, expected: string, detail: string) => {
          const hasRule = rules.some((r) => String(r?.path_regex || "") === expected);
          push({
            status: hasRule ? "ok" : "missing",
            label,
            detail: hasRule ? "(ok)" : detail,
          });
        };

        try {
          const rel = getHostSecretsSopsCreationRulePathSuffix(params.layout, host);
          const expected = getHostSecretsSopsCreationRulePathRegex(params.layout, host);
          checkRule("sops creation rule (host secrets)", expected, `(missing rule for ${rel}/*.yaml; run: clawdlets secrets init)`);
        } catch (e) {
          push({ status: "warn", label: "sops creation rule (host secrets)", detail: String((e as Error)?.message || e) });
        }

        try {
          const rel = getHostAgeKeySopsCreationRulePathSuffix(params.layout, host);
          const expected = getHostAgeKeySopsCreationRulePathRegex(params.layout, host);
          checkRule("sops creation rule (host age key)", expected, `(missing rule for ${rel}; run: clawdlets secrets init)`);
        } catch (e) {
          push({ status: "warn", label: "sops creation rule (host age key)", detail: String((e as Error)?.message || e) });
        }
      }
    }
  }

  if (isServerDeploy) {
    push({
      status: "ok",
      label: "GITHUB_TOKEN",
      detail: "(not required; cache-only deploy)",
    });
    return;
  }

  if (params.skipGithubTokenCheck) {
    push({
      status: "ok",
      label: "GITHUB_TOKEN",
      detail: "(skipped)",
    });
    return;
  }

  const flakeResolved = clawdletsCfg ? (await resolveBaseFlake({ repoRoot: params.repoRoot, config: clawdletsCfg })).flake : null;
  const flakeBase = flakeResolved || (await tryGetOriginFlake(params.repoRoot)) || params.repoRoot;
  const githubRepo = tryParseGithubFlakeUri(flakeBase);

  if (!githubRepo) {
    push({
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
      push({
        status: "ok",
        label: "GITHUB_TOKEN",
        detail: `(set; has access to ${githubRepo.owner}/${githubRepo.repo})`,
      });
    } else if (check.ok && check.status === "unauthorized") {
      push({
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: "(invalid/expired; GitHub API returned 401)",
      });
    } else if (check.ok && check.status === "private-or-missing") {
      push({
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: `(set but no access; GitHub API returned 404 for ${githubRepo.owner}/${githubRepo.repo})`,
      });
    } else if (check.ok && check.status === "rate-limited") {
      push({
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(set; GitHub API rate-limited during verification)",
      });
    } else {
      push({
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
    push({
      status: "ok",
      label: "GITHUB_TOKEN",
      detail: `(optional; ${githubRepo.owner}/${githubRepo.repo} is public)`,
    });
  } else if (check.ok && check.status === "private-or-missing") {
    push({
      status: "missing",
      label: "GITHUB_TOKEN",
      detail: `(required; ${githubRepo.owner}/${githubRepo.repo} is private)`,
    });
  } else if (check.ok && check.status === "rate-limited") {
    push({
      status: "warn",
      label: "GITHUB_TOKEN",
      detail: "(unknown; GitHub API rate-limited; if bootstrap fails with 404, set token)",
    });
  } else {
    push({
      status: "warn",
      label: "GITHUB_TOKEN",
      detail: "(unknown; could not verify repo visibility; if bootstrap fails with 404, set token)",
    });
  }
}
