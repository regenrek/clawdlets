import fs from "node:fs";
import path from "node:path";
import type { RepoLayout } from "../repo-layout.js";
import { capture } from "../lib/run.js";
import { findInlineScriptingViolations } from "../lib/inline-script-ban.js";
import { validateDocsIndexIntegrity } from "../lib/docs-index.js";
import { validateFleetPolicy, type FleetConfig } from "../lib/fleet-policy.js";
import { evalFleetConfig } from "../lib/fleet-nix-eval.js";
import { ClawdletsConfigSchema } from "../lib/clawdlets-config.js";
import { getHostNixPath } from "../repo-layout.js";
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

function nixUserHasWheel(params: { hostText: string; user: string }): boolean {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`users\\.users\\.${escapeRegex(params.user)}\\s*=\\s*\\{([\\s\\S]*?)\\};`, "g");
  const blocks = Array.from(params.hostText.matchAll(rx)).map((m) => String(m[1] ?? ""));
  for (const block of blocks) {
    if (/extraGroups\s*=\s*\[[\s\S]*?"wheel"[\s\S]*?\]\s*;/m.test(block)) return true;
  }
  return false;
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

  params.push({
    scope: "repo",
    status: fs.existsSync(path.join(repoRoot, "flake.nix")) ? "ok" : "missing",
    label: "repo root",
    detail: repoRoot,
  });

  params.push({
    scope: "repo",
    status: fs.existsSync(layout.opentofuDir) ? "ok" : "missing",
    label: "opentofu dir",
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
        const out = await capture("git", ["ls-files", "-z"], { cwd: repoRoot });
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
    const configPath = layout.clawdletsConfigPath;
    if (!fs.existsSync(configPath)) {
      params.push({ scope: "repo", status: "missing", label: "clawdlets config", detail: configPath });
    } else {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw);
        ClawdletsConfigSchema.parse(parsed);
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

    const fleetNixPath = layout.fleetConfigPath;
    if (fs.existsSync(fleetNixPath)) {
      const fleetText = fs.readFileSync(fleetNixPath, "utf8");
      const ok = fleetText.includes("builtins.fromJSON") && fleetText.includes("clawdlets.json");
      params.push({
        scope: "repo",
        status: ok ? "ok" : "missing",
        label: "fleet reads clawdlets.json",
        detail: ok ? "(ok)" : `(expected ${path.relative(repoRoot, fleetNixPath)} to read fleet/clawdlets.json)`,
      });
    }
  }

  const fleetPath = layout.fleetConfigPath;
  if (fs.existsSync(fleetPath)) {
    try {
      fleet = await evalFleetConfig({ repoRoot, fleetFilePath: fleetPath, nixBin: params.nixBin });
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
        const r = validateFleetPolicy({ filePath: fleetPath, fleet, knownBundledSkills: bundledSkills.skills });
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
        const templateFleetPath = path.join(templateRoot, "infra", "configs", "fleet.nix");
        if (!fs.existsSync(templateFleetPath)) {
          params.push({ scope: "repo", status: "missing", label: "template fleet config", detail: templateFleetPath });
        } else {
          const tplFleet = await evalFleetConfig({ repoRoot, fleetFilePath: templateFleetPath, nixBin: params.nixBin });
          params.push({
            scope: "repo",
            status: tplFleet.bots.length > 0 ? "ok" : "warn",
            label: "template fleet config eval",
            detail: `(bots: ${tplFleet.bots.length})`,
          });

          const r = validateFleetPolicy({ filePath: templateFleetPath, fleet: tplFleet, knownBundledSkills: bundledSkills.skills });
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
      }
    } catch (e) {
      params.push({
        scope: "repo",
        status: "missing",
        label: "fleet config eval",
        detail: String((e as Error)?.message || e),
      });
    }
  } else {
    params.push({ scope: "repo", status: "missing", label: "fleet config", detail: fleetPath });
  }

  {
    const hostNixFile = getHostNixPath(layout, params.host);
    if (fs.existsSync(hostNixFile)) {
      const hostText = fs.readFileSync(hostNixFile, "utf8");

      {
        const ok = hostText.includes("builtins.fromJSON") && hostText.includes("clawdlets.json") && hostText.includes("hostCfg");
        params.push({
          scope: "repo",
          status: ok ? "ok" : "warn",
          label: "host reads clawdlets.json",
          detail: ok ? "(ok)" : `(expected ${path.relative(repoRoot, hostNixFile)} to read fleet/clawdlets.json)`,
        });
      }

      if (nixUserHasWheel({ hostText, user: "admin" })) {
        params.push({
          scope: "repo",
          status: "missing",
          label: "admin wheel access",
          detail: "(admin is in wheel; violates ops invariants)",
        });
      } else {
        params.push({
          scope: "repo",
          status: "ok",
          label: "admin wheel access",
          detail: "(admin not in wheel)",
        });
      }

      if (nixUserHasWheel({ hostText, user: "breakglass" })) {
        params.push({
          scope: "repo",
          status: "ok",
          label: "breakglass wheel access",
          detail: "(breakglass is in wheel)",
        });
      } else {
        params.push({
          scope: "repo",
          status: "missing",
          label: "breakglass wheel access",
          detail: "(missing breakglass user in wheel; required for recovery without giving admin sudo)",
        });
      }
    } else {
      params.push({ scope: "repo", status: "missing", label: "host nix config", detail: hostNixFile });
    }
  }

  if (templateRoot) {
    const templateHostNix = path.join(templateRoot, "infra", "nix", "hosts", "clawdlets-host.nix");
    if (!fs.existsSync(templateHostNix)) {
      params.push({ scope: "repo", status: "missing", label: "template host nix config", detail: templateHostNix });
    } else {
      const hostText = fs.readFileSync(templateHostNix, "utf8");
      const ok = hostText.includes("builtins.fromJSON") && hostText.includes("clawdlets.json") && hostText.includes("hostCfg");
      params.push({
        scope: "repo",
        status: ok ? "ok" : "missing",
        label: "template host reads clawdlets.json",
        detail: ok ? "(ok)" : "(expected template host config to read fleet/clawdlets.json)",
      });
    }
  }

  return {
    bundledSkills: bundledSkills.skills,
    fleet,
    fleetBots,
  };
}
