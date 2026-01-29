import fs from "node:fs";
import path from "node:path";
import type { RepoLayout } from "../repo-layout.js";
import { capture } from "../lib/run.js";
import { findInlineScriptingViolations } from "../lib/inline-script-ban.js";
import { validateDocsIndexIntegrity } from "../lib/docs-index.js";
import { validateFleetPolicy, type FleetConfig } from "../lib/fleet-policy.js";
import { evalFleetConfig } from "../lib/fleet-nix-eval.js";
import { ClawdletsConfigSchema, type ClawdletsConfig } from "../lib/clawdlets-config.js";
import { buildClawdbotBotConfig } from "../lib/clawdbot-config-invariants.js";
import { lintClawdbotSecurityConfig } from "../lib/clawdbot-security-lint.js";
import { checkSchemaVsNixClawdbot } from "./schema-checks.js";
import { findClawdbotSecretViolations, findFleetSecretViolations } from "./repo-checks-secrets.js";
import { evalWheelAccess, getClawdletsRevFromFlakeLock } from "./repo-checks-nix.js";
import type { DoctorPush } from "./types.js";
import { dirHasAnyFile, loadKnownBundledSkills, resolveTemplateRoot } from "./util.js";

export type RepoDoctorResult = {
  bundledSkills: string[];
  fleet: FleetConfig | null;
  fleetBots: string[] | null;
};

function allExist(paths: string[]): { ok: boolean; missing: string[] } {
  const missing = paths.filter((p) => !fs.existsSync(p));
  return { ok: missing.length === 0, missing };
}

export async function addRepoChecks(params: {
  repoRoot: string;
  layout: RepoLayout;
  host: string;
  nixBin: string;
  push: DoctorPush;
}): Promise<RepoDoctorResult> {
  const { repoRoot, layout } = params;

  let fleet: FleetConfig | null = null;
  let fleetBots: string[] | null = null;
  let clawdletsConfig: ClawdletsConfig | null = null;

  params.push({
    scope: "repo",
    status: fs.existsSync(path.join(repoRoot, "flake.nix")) ? "ok" : "missing",
    label: "repo root",
    detail: repoRoot,
  });

  // Check clawdlets input in flake.lock (informational)
  {
    const flakeRev = getClawdletsRevFromFlakeLock(repoRoot);
    if (flakeRev) {
      params.push({
        scope: "repo",
        status: "ok",
        label: "clawdlets flake input",
        detail: `rev: ${flakeRev.slice(0, 12)}...`,
      });
    } else {
      const flakeLockExists = fs.existsSync(path.join(repoRoot, "flake.lock"));
      if (flakeLockExists) {
        // flake.lock exists but no clawdlets input - might be a different project type
        params.push({
          scope: "repo",
          status: "warn",
          label: "clawdlets flake input",
          detail: "(no clawdlets input found in flake.lock)",
        });
      }
      // If flake.lock doesn't exist, skip this check silently (test environments, etc.)
    }
  }

  {
    const checks = await checkSchemaVsNixClawdbot({ repoRoot });
    for (const check of checks) params.push(check);
  }

  params.push({
    scope: "repo",
    status: fs.existsSync(layout.opentofuDir) ? "ok" : "warn",
    label: "provisioning state dir",
    detail: layout.opentofuDir,
  });

  const templateRoot = resolveTemplateRoot(repoRoot);
  const bundledSkills = loadKnownBundledSkills(repoRoot, templateRoot);
  if (!bundledSkills.ok) {
    params.push({
      scope: "repo",
      status: "missing",
      label: "bundled skills index",
      detail: bundledSkills.errors.join("; "),
    });
  } else {
    params.push({
      scope: "repo",
      status: "ok",
      label: "bundled skills index",
      detail: `(${bundledSkills.skills.length} skills)`,
    });
  }

  {
    const legacyRepoSecretsDir = path.join(repoRoot, "infra", "secrets");

    if (dirHasAnyFile(legacyRepoSecretsDir)) {
      params.push({
        scope: "repo",
        status: "missing",
        label: "public repo hygiene",
        detail: "infra/secrets must not exist (legacy; secrets now live under /secrets and must be sops-encrypted)",
      });
    } else {
      try {
        const out = await capture("git", ["ls-files", "-z", "--", ".clawdlets", "infra/secrets", "secrets"], { cwd: repoRoot });
        const tracked = out.split("\0").filter(Boolean);
        const trackedClawdlets = tracked.filter((p) => p === ".clawdlets" || p.startsWith(".clawdlets/"));
        const trackedLegacySecrets = tracked.filter((p) => p === "infra/secrets" || p.startsWith("infra/secrets/"));
        const trackedPlainAgeKeys = tracked.filter((p) => p.startsWith("secrets/") && p.endsWith(".agekey"));

        if (trackedClawdlets.length > 0 || trackedLegacySecrets.length > 0 || trackedPlainAgeKeys.length > 0) {
          const bad = [...trackedClawdlets, ...trackedLegacySecrets, ...trackedPlainAgeKeys];
          params.push({
            scope: "repo",
            status: "missing",
            label: "public repo hygiene",
            detail: `tracked forbidden paths: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` (+${bad.length - 3})` : ""}`,
          });
        } else {
          params.push({
            scope: "repo",
            status: "ok",
            label: "public repo hygiene",
            detail: "(no tracked .clawdlets; no infra/secrets; no plaintext *.agekey in /secrets)",
          });
        }
      } catch {
        params.push({
          scope: "repo",
          status: "warn",
          label: "public repo hygiene",
          detail: "(git not available; cannot verify tracked paths)",
        });
      }
    }
  }

  const inlineViolations = findInlineScriptingViolations({ repoRoot });
  if (inlineViolations.length > 0) {
    const first = inlineViolations[0]!;
    params.push({
      scope: "repo",
      status: "missing",
      label: "inline scripting ban",
      detail: `${inlineViolations.length} violation(s) (first: ${path.relative(repoRoot, first.filePath)}:${first.line} ${first.rule})`,
    });
  } else {
    params.push({ scope: "repo", status: "ok", label: "inline scripting ban", detail: "(clean)" });
  }

  {
    const r = validateDocsIndexIntegrity({ repoRoot, templateRoot });
    if (!r.ok) {
      params.push({
        scope: "repo",
        status: "missing",
        label: "docs index integrity",
        detail: r.errors.join("; "),
      });
    } else {
      params.push({
        scope: "repo",
        status: "ok",
        label: "docs index integrity",
        detail: templateRoot
          ? "(docs/docs.yaml matches template; all files exist)"
          : "(docs/docs.yaml valid; all files exist)",
      });
    }
  }

  {
    const commonDir = path.join(repoRoot, "fleet", "workspaces", "common");
    const required = [
      path.join(commonDir, "AGENTS.md"),
      path.join(commonDir, "SOUL.md"),
      path.join(commonDir, "IDENTITY.md"),
      path.join(commonDir, "TOOLS.md"),
      path.join(commonDir, "USER.md"),
      path.join(commonDir, "HEARTBEAT.md"),
    ];

    const r = allExist(required);
    params.push({
      scope: "repo",
      status: r.ok ? "ok" : "missing",
      label: "fleet workspaces",
      detail: r.ok ? "(common docs present)" : `missing: ${r.missing.map((p) => path.relative(repoRoot, p)).join(", ")}`,
    });

    if (templateRoot) {
      const templateCommonDir = path.join(templateRoot, "fleet", "workspaces", "common");
      const templateRequired = required.map((p) => path.join(templateCommonDir, path.basename(p)));
      const rt = allExist(templateRequired);
      params.push({
        scope: "repo",
        status: rt.ok ? "ok" : "missing",
        label: "template fleet workspaces",
        detail: rt.ok ? "(common docs present)" : `missing: ${rt.missing.map((p) => path.relative(repoRoot, p)).join(", ")}`,
      });
    }
  }

  {
    const scan = findClawdbotSecretViolations(repoRoot);
    if (scan.violations.length > 0) {
      const first = scan.violations[0]!;
      params.push({
        scope: "repo",
        status: "missing",
        label: "clawdbot config secrets",
        detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
      });
    } else {
      params.push({
        scope: "repo",
        status: "ok",
        label: "clawdbot config secrets",
        detail: scan.files.length > 0 ? `(scanned ${scan.files.length} clawdbot.json5)` : "(no clawdbot.json5 found)",
      });
    }

    if (templateRoot) {
      const scanTemplate = findClawdbotSecretViolations(templateRoot);
      if (scanTemplate.violations.length > 0) {
        const first = scanTemplate.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: "template clawdbot config secrets",
          detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
        });
      } else {
        params.push({
          scope: "repo",
          status: "ok",
          label: "template clawdbot config secrets",
          detail:
            scanTemplate.files.length > 0 ? `(scanned ${scanTemplate.files.length} clawdbot.json5)` : "(no clawdbot.json5 found)",
        });
      }
    }
  }

  {
    const scan = findFleetSecretViolations(repoRoot);
    if (scan.violations.length > 0) {
      const first = scan.violations[0]!;
      params.push({
        scope: "repo",
        status: "missing",
        label: "fleet config secrets",
        detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
      });
    } else {
      params.push({
        scope: "repo",
        status: "ok",
        label: "fleet config secrets",
        detail: scan.files.length > 0 ? `(scanned ${scan.files.length} clawdlets.json)` : "(no clawdlets.json found)",
      });
    }

    if (templateRoot) {
      const scanTemplate = findFleetSecretViolations(templateRoot);
      if (scanTemplate.violations.length > 0) {
        const first = scanTemplate.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: "template fleet config secrets",
          detail: `${path.relative(repoRoot, first.file)} matched ${first.label}`,
        });
      } else {
        params.push({
          scope: "repo",
          status: "ok",
          label: "template fleet config secrets",
          detail:
            scanTemplate.files.length > 0 ? `(scanned ${scanTemplate.files.length} clawdlets.json)` : "(no clawdlets.json found)",
        });
      }
    }
  }

  {
    const configPath = layout.clawdletsConfigPath;
    if (!fs.existsSync(configPath)) {
      params.push({ scope: "repo", status: "missing", label: "clawdlets config", detail: configPath });
    } else {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw);
        clawdletsConfig = ClawdletsConfigSchema.parse(parsed);
        params.push({ scope: "repo", status: "ok", label: "clawdlets config", detail: path.relative(repoRoot, configPath) });
      } catch (e) {
        params.push({ scope: "repo", status: "missing", label: "clawdlets config", detail: String((e as Error)?.message || e) });
      }
    }

    if (templateRoot) {
      const templateConfigPath = path.join(templateRoot, "fleet", "clawdlets.json");
      if (!fs.existsSync(templateConfigPath)) {
        params.push({ scope: "repo", status: "missing", label: "template clawdlets config", detail: templateConfigPath });
      } else {
        try {
          const raw = fs.readFileSync(templateConfigPath, "utf8");
          const parsed = JSON.parse(raw);
          ClawdletsConfigSchema.parse(parsed);
          params.push({
            scope: "repo",
            status: "ok",
            label: "template clawdlets config",
            detail: path.relative(repoRoot, templateConfigPath),
          });
        } catch (e) {
          params.push({
            scope: "repo",
            status: "missing",
            label: "template clawdlets config",
            detail: String((e as Error)?.message || e),
          });
        }
      }
    }

  }

  if (clawdletsConfig) {
    const bots = Array.isArray(clawdletsConfig?.fleet?.botOrder) ? clawdletsConfig.fleet.botOrder : [];
    for (const botRaw of bots) {
      const bot = String(botRaw || "").trim();
      if (!bot) continue;
      try {
        const merged = buildClawdbotBotConfig({ config: clawdletsConfig, bot }).merged;
        const report = lintClawdbotSecurityConfig({ clawdbot: merged, botId: bot });
        const status = report.summary.critical > 0 ? "missing" : report.summary.warn > 0 ? "warn" : "ok";
        const top = report.findings
          .filter((f) => f.severity === "critical" || f.severity === "warn")
          .slice(0, 2)
          .map((f) => f.id)
          .join(", ");
        const hint = top ? ` (${top}${report.findings.length > 2 ? ` +${report.findings.length - 2}` : ""})` : "";
        params.push({
          scope: "repo",
          status,
          label: `clawdbot security (${bot})`,
          detail: `critical=${report.summary.critical} warn=${report.summary.warn} info=${report.summary.info}${hint}`,
        });
      } catch (e) {
        params.push({
          scope: "repo",
          status: "warn",
          label: `clawdbot security (${bot})`,
          detail: `unable to lint: ${String((e as Error)?.message || e)}`,
        });
      }
    }
  }

  try {
    fleet = await evalFleetConfig({ repoRoot, nixBin: params.nixBin });
    fleetBots = fleet.bots;

    params.push({
      scope: "repo",
      status: fleet.bots.length > 0 ? "ok" : "missing",
      label: "fleet config eval",
      detail: `(bots: ${fleet.bots.length})`,
    });

    params.push({
      scope: "repo",
      status: fleet.bots.length > 0 ? "ok" : "warn",
      label: "fleet bots list",
      detail: fleet.bots.length > 0 ? fleet.bots.join(", ") : "(empty)",
    });

    {
      const r = validateFleetPolicy({ filePath: layout.clawdletsConfigPath, fleet, knownBundledSkills: bundledSkills.skills });
      if (!r.ok) {
        const first = r.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: "fleet policy",
          detail: `${path.relative(repoRoot, first.filePath)} ${first.message}${first.detail ? ` (${first.detail})` : ""}`,
        });
      } else {
        params.push({ scope: "repo", status: "ok", label: "fleet policy", detail: "(ok)" });
      }
    }

    if (templateRoot) {
      const tplFleet = await evalFleetConfig({ repoRoot: templateRoot, nixBin: params.nixBin });
      params.push({
        scope: "repo",
        status: tplFleet.bots.length > 0 ? "ok" : "warn",
        label: "template fleet config eval",
        detail: `(bots: ${tplFleet.bots.length})`,
      });

      const r = validateFleetPolicy({ filePath: path.join(templateRoot, "fleet", "clawdlets.json"), fleet: tplFleet, knownBundledSkills: bundledSkills.skills });
      if (!r.ok) {
        const first = r.violations[0]!;
        params.push({
          scope: "repo",
          status: "missing",
          label: "template fleet policy",
          detail: `${path.relative(repoRoot, first.filePath)} ${first.message}${first.detail ? ` (${first.detail})` : ""}`,
        });
      } else {
        params.push({ scope: "repo", status: "ok", label: "template fleet policy", detail: "(ok)" });
      }
    }
  } catch (e) {
    params.push({
      scope: "repo",
      status: "missing",
      label: "fleet config eval",
      detail: String((e as Error)?.message || e),
    });
  }

  {
    const wheel = await evalWheelAccess({ repoRoot, nixBin: params.nixBin, host: params.host });
    if (!wheel) {
      params.push({
        scope: "repo",
        status: "warn",
        label: "wheel access",
        detail: "(unable to evaluate nixosConfigurations.<host>.config; skipping wheel checks)",
      });
    } else {
      params.push({
        scope: "repo",
        status: wheel.adminHasWheel ? "missing" : "ok",
        label: "admin wheel access",
        detail: wheel.adminHasWheel ? "(admin is in wheel; violates ops invariants)" : "(admin not in wheel)",
      });

      params.push({
        scope: "repo",
        status: wheel.breakglassHasWheel ? "ok" : "missing",
        label: "breakglass wheel access",
        detail: wheel.breakglassHasWheel
          ? "(breakglass is in wheel)"
          : "(missing breakglass user in wheel; required for recovery without giving admin sudo)",
      });
    }
  }

  return {
    bundledSkills: bundledSkills.skills,
    fleet,
    fleetBots,
  };
}
