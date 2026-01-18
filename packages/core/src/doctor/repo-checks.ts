import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { RepoLayout } from "../repo-layout.js";
import { capture } from "../lib/run.js";
import { findInlineScriptingViolations } from "../lib/inline-script-ban.js";
import { validateDocsIndexIntegrity } from "../lib/docs-index.js";
import { validateFleetPolicy, type FleetConfig } from "../lib/fleet-policy.js";
import { evalFleetConfig } from "../lib/fleet-nix-eval.js";
import { withFlakesEnv } from "../lib/nix-flakes.js";
import { ClawdletsConfigSchema } from "../lib/clawdlets-config.js";
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

const CLAWDBOT_SECRET_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "openai sk- token", regex: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { label: "github token", regex: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { label: "github fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: "slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "google api key", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { label: "literal token assignment", regex: /"token"\s*:\s*"(?!\$\{)(?!CHANGE_ME)(?!REDACTED)[^"]{16,}"/ },
];

const INCLUDE_PATTERN = /["']?\$include["']?\s*:\s*(['"])([^'"]+)\1/g;
const MAX_SCAN_BYTES = 128 * 1024;

function listClawdbotConfigFiles(root: string): string[] {
  const botsDir = path.join(root, "fleet", "workspaces", "bots");
  if (!fs.existsSync(botsDir)) return [];
  const entries = fs.readdirSync(botsDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(botsDir, entry.name, "clawdbot.json5");
    if (fs.existsSync(cfgPath)) files.push(cfgPath);
  }
  return files;
}

function readFilePrefix(filePath: string): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(MAX_SCAN_BYTES);
    const bytes = fs.readSync(fd, buf, 0, MAX_SCAN_BYTES, 0);
    return buf.subarray(0, bytes).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function extractIncludePaths(raw: string): string[] {
  const matches: string[] = [];
  for (const match of raw.matchAll(INCLUDE_PATTERN)) {
    const value = String(match[2] || "").trim();
    if (value) matches.push(value);
  }
  return matches;
}

function resolveIncludePath(params: { root: string; baseDir: string; includePath: string }): string | null {
  const raw = params.includePath.trim();
  if (!raw || raw.includes("${")) return null;
  if (path.isAbsolute(raw)) {
    const full = path.resolve(raw);
    if (!full.startsWith(params.root + path.sep)) return null;
    return fs.existsSync(full) ? full : null;
  }
  const full = path.resolve(params.baseDir, raw);
  if (!full.startsWith(params.root + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function findClawdbotSecretViolations(root: string): { files: string[]; violations: { file: string; label: string }[] } {
  const initial = listClawdbotConfigFiles(root);
  const files: string[] = [];
  const violations: { file: string; label: string }[] = [];
  const visited = new Set<string>();

  const scanFile = (filePath: string) => {
    const fullPath = path.resolve(filePath);
    if (visited.has(fullPath)) return;
    visited.add(fullPath);
    files.push(fullPath);

    const raw = readFilePrefix(fullPath);
    for (const pattern of CLAWDBOT_SECRET_PATTERNS) {
      if (pattern.regex.test(raw)) {
        violations.push({ file: fullPath, label: pattern.label });
        return;
      }
    }

    const includes = extractIncludePaths(raw);
    if (includes.length === 0) return;
    const baseDir = path.dirname(fullPath);
    for (const includePath of includes) {
      const resolved = resolveIncludePath({ root, baseDir, includePath });
      if (!resolved) continue;
      scanFile(resolved);
    }
  };

  for (const filePath of initial) scanFile(filePath);
  return { files, violations };
}

async function evalWheelAccess(params: { repoRoot: string; nixBin: string; host: string }): Promise<{
  adminHasWheel: boolean;
  breakglassHasWheel: boolean;
} | null> {
  const expr = [
    "let",
    "  flake = builtins.getFlake (toString ./.);",
    `  cfg = flake.nixosConfigurations.${JSON.stringify(params.host)}.config;`,
    "  admin = cfg.users.users.admin or {};",
    "  breakglass = cfg.users.users.breakglass or {};",
    "  adminGroups = admin.extraGroups or [];",
    "  breakglassGroups = breakglass.extraGroups or [];",
    "in {",
    "  adminHasWheel = builtins.elem \"wheel\" adminGroups;",
    "  breakglassHasWheel = builtins.elem \"wheel\" breakglassGroups;",
    "}",
  ].join("\n");
  try {
    const out = await capture(params.nixBin, ["eval", "--impure", "--json", "--expr", expr], {
      cwd: params.repoRoot,
      env: withFlakesEnv(process.env),
    });
    const parsed = JSON.parse(out);
    return {
      adminHasWheel: Boolean(parsed?.adminHasWheel),
      breakglassHasWheel: Boolean(parsed?.breakglassHasWheel),
    };
  } catch {
    return null;
  }
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
