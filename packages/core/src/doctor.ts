import process from "node:process";
import { getRepoLayout } from "./repo-layout.js";
import { expandPath } from "./lib/path-expand.js";
import { findRepoRoot } from "./lib/repo.js";
import { addRepoChecks } from "./doctor/repo-checks.js";
import { addDeployChecks } from "./doctor/deploy-checks.js";
import type { DoctorCheck } from "./doctor/types.js";

export type { DoctorCheck } from "./doctor/types.js";

export async function collectDoctorChecks(params: {
  cwd: string;
  runtimeDir?: string;
  host: string;
  scope?: "repo" | "deploy" | "all";
}): Promise<DoctorCheck[]> {
  const repoRoot = findRepoRoot(params.cwd);
  const layout = getRepoLayout(repoRoot, params.runtimeDir);

  const wantRepo = params.scope === "repo" || params.scope === "all" || params.scope == null;
  const wantDeploy = params.scope === "deploy" || params.scope === "all" || params.scope == null;

  const checks: DoctorCheck[] = [];
  const push = (c: DoctorCheck) => {
    if (c.scope === "repo" && !wantRepo) return;
    if (c.scope === "deploy" && !wantDeploy) return;
    checks.push(c);
  };

  const getEnv = (k: string): string | undefined => {
    const v = process.env[k];
    const trimmed = String(v ?? "").trim();
    return trimmed ? trimmed : undefined;
  };

  const HCLOUD_TOKEN = getEnv("HCLOUD_TOKEN");
  const NIX_BIN = getEnv("NIX_BIN") || "nix";
  const GITHUB_TOKEN = getEnv("GITHUB_TOKEN");
  const SOPS_AGE_KEY_FILE_RAW = getEnv("SOPS_AGE_KEY_FILE");
  const SOPS_AGE_KEY_FILE = SOPS_AGE_KEY_FILE_RAW ? expandPath(SOPS_AGE_KEY_FILE_RAW) : undefined;

  const host = params.host.trim() || "clawdbot-fleet-host";

  const repoResult = await addRepoChecks({
    repoRoot,
    layout,
    host,
    nixBin: NIX_BIN,
    push,
  });

  if (wantDeploy) {
    await addDeployChecks({
      cwd: params.cwd,
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      hcloudToken: HCLOUD_TOKEN,
      sopsAgeKeyFile: SOPS_AGE_KEY_FILE,
      githubToken: GITHUB_TOKEN,
      fleetBots: repoResult.fleetBots,
      push,
    });
  }

  return checks;
}
