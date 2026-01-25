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
import { buildFleetSecretsPlan } from "../lib/fleet-secrets-plan.js";
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
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "../lib/github.js";
import { tryGetOriginFlake } from "../lib/git.js";
import { expandPath } from "../lib/path-expand.js";
import { resolveBaseFlake } from "../lib/base-flake.js";
import { agePublicKeyFromIdentityFile } from "../lib/age-keygen.js";
import { sopsDecryptYamlFile } from "../lib/sops.js";
import { getSopsCreationRuleAgeRecipients } from "../lib/sops-config.js";
import { readYamlScalarFromMapping } from "../lib/yaml-scalar.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
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

      {
        const diskDevice = String((clawdletsHostCfg as any).diskDevice || "").trim();
        if (!diskDevice) {
          push({ status: "missing", label: "diskDevice", detail: "(unset; set via: clawdlets host set --disk-device /dev/sda)" });
        } else if (!diskDevice.startsWith("/dev/")) {
          push({ status: "missing", label: "diskDevice", detail: `(invalid: ${diskDevice}; expected /dev/... )` });
        } else if (diskDevice.includes("CHANGE_ME")) {
          push({ status: "missing", label: "diskDevice", detail: `(placeholder: ${diskDevice}; set via: clawdlets host set --disk-device /dev/sda)` });
        } else {
          push({ status: "ok", label: "diskDevice", detail: diskDevice });
        }
      }

      const adminCidr = String(clawdletsHostCfg.provisioning?.adminCidr || "").trim();
      push({
        status: adminCidr ? "ok" : "missing",
        label: "provisioning.adminCidr",
        detail: adminCidr || "(unset)",
      });

      {
        const raw = String(clawdletsHostCfg.provisioning?.sshPubkeyFile || "").trim();
        if (!raw) {
          push({ status: "missing", label: "provisioning ssh pubkey file", detail: "(unset)" });
        } else if (looksLikeSshKeyContents(raw)) {
          push({
            status: "missing",
            label: "provisioning ssh pubkey file",
            detail: "(must be a path, not key contents)",
          });
        } else {
          const expanded = expandPath(raw);
          const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.repoRoot, expanded);
          push({ status: fs.existsSync(abs) ? "ok" : "missing", label: "provisioning ssh pubkey file", detail: abs });

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

    let secretsPlan: ReturnType<typeof buildFleetSecretsPlan> | null = null;
    try {
      if (clawdletsCfg) secretsPlan = buildFleetSecretsPlan({ config: clawdletsCfg as any, hostName: host });
    } catch (e) {
      push({ status: "warn", label: "fleet secrets plan", detail: String((e as Error)?.message || e) });
      secretsPlan = null;
    }

    if (secretsPlan && secretsPlan.missingSecretConfig.length > 0) {
      for (const m of secretsPlan.missingSecretConfig.slice(0, 10)) {
        const detail =
          m.kind === "envVar"
            ? `missing mapping bot=${m.bot} envVar=${m.envVar} (set fleet.secretEnv.${m.envVar} or fleet.bots.${m.bot}.profile.secretEnv.${m.envVar})`
            : `invalid secret file scope=${m.scope}${m.bot ? ` bot=${m.bot}` : ""} id=${m.fileId} targetPath=${m.targetPath} (${m.message})`;
        push({
          status: "missing",
          label: "fleet secrets",
          detail,
        });
      }
      if (secretsPlan.missingSecretConfig.length > 10) {
        push({
          status: "missing",
          label: "fleet secrets",
          detail: `(+${secretsPlan.missingSecretConfig.length - 10} more missing entries)`,
        });
      }
    }

    const botsForSecrets = secretsPlan?.bots?.length ? secretsPlan.bots : params.fleetBots || [];
    const hostSecretNamesRequired = secretsPlan?.hostSecretNamesRequired || ["admin_password_hash"];
    const secretNamesAll = secretsPlan?.secretNamesAll || [];

    if (botsForSecrets.length > 0) {
      const required = Array.from(new Set([
        ...hostSecretNamesRequired,
        ...secretNamesAll,
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
      push({ status: "warn", label: "required secrets", detail: "(fleet bots list missing; cannot validate per-bot secrets)" });
    }

    const requiredForValues = Array.from(new Set([
      ...(secretsPlan?.hostSecretNamesRequired || []),
      ...(secretsPlan?.secretNamesRequired || []),
    ]));

    if (requiredForValues.length > 0 && params.sopsAgeKeyFile && fs.existsSync(params.sopsAgeKeyFile)) {
      const nix = { nixBin: params.nixBin, cwd: params.repoRoot, dryRun: false, env: process.env } as const;
      const checks = await mapWithConcurrency({
        items: requiredForValues,
        concurrency: 4,
        fn: async (secretName) => {
          const filePath = path.join(secretsLocalDir, `${secretName}.yaml`);
          if (!fs.existsSync(filePath)) return null;
          try {
            const decrypted = await sopsDecryptYamlFile({
              filePath,
              configPath: params.layout.sopsConfigPath,
              ageKeyFile: params.sopsAgeKeyFile,
              nix,
            });
            const v = readYamlScalarFromMapping({ yamlText: decrypted, key: secretName }) || "";
            const value = v.trim();
            if (!value) return { status: "missing" as const, label: `secret value: ${secretName}`, detail: "(empty)" };
            if (value === "<OPTIONAL>" || isPlaceholderSecretValue(value)) {
              return { status: "missing" as const, label: `secret value: ${secretName}`, detail: `(placeholder: ${value})` };
            }
            return { status: "ok" as const, label: `secret value: ${secretName}` };
          } catch (e) {
            return { status: "warn" as const, label: `secret value: ${secretName}`, detail: String((e as Error)?.message || e) };
          }
        },
      });

      for (const c of checks) {
        if (!c) continue;
        push(c);
      }
    } else if (requiredForValues.length > 0) {
      push({
        status: "warn",
        label: "required secrets",
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

        if (params.sopsAgeKeyFile && fs.existsSync(params.sopsAgeKeyFile)) {
          const nix = { nixBin: params.nixBin, cwd: params.repoRoot, dryRun: false, env: process.env } as const;
          try {
            const operatorPub = await agePublicKeyFromIdentityFile(params.sopsAgeKeyFile, nix);
            const hostSecretsRule = getHostSecretsSopsCreationRulePathRegex(params.layout, host);
            const hostKeyRule = getHostAgeKeySopsCreationRulePathRegex(params.layout, host);
            const hostSecretsRecipients = getSopsCreationRuleAgeRecipients({ existingYaml: sopsText, pathRegex: hostSecretsRule });
            const hostKeyRecipients = getSopsCreationRuleAgeRecipients({ existingYaml: sopsText, pathRegex: hostKeyRule });
            const formatRecipients = (recipients: string[]) => (recipients.length ? recipients.join(", ") : "(none)");

            if (hostSecretsRecipients.length > 0 && !hostSecretsRecipients.includes(operatorPub)) {
              push({
                status: "missing",
                label: "sops recipients (host secrets)",
                detail: `operator key ${operatorPub} not in recipients: ${formatRecipients(hostSecretsRecipients)}; run: clawdlets secrets init --yes (or set SOPS_AGE_KEY_FILE to the matching key)`,
              });
            }
            if (hostKeyRecipients.length > 0 && !hostKeyRecipients.includes(operatorPub)) {
              push({
                status: "missing",
                label: "sops recipients (host age key)",
                detail: `operator key ${operatorPub} not in recipients: ${formatRecipients(hostKeyRecipients)}; run: clawdlets secrets init --yes (or set SOPS_AGE_KEY_FILE to the matching key)`,
              });
            }
          } catch (e) {
            push({
              status: "warn",
              label: "sops recipients (operator key)",
              detail: `failed to derive operator public key: ${String((e as Error)?.message || e)}`,
            });
          }
        }

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
