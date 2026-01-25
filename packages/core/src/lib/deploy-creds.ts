import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { getRepoLayout } from "../repo-layout.js";
import { formatDotenvValue } from "./dotenv-file.js";
import { expandPath } from "./path-expand.js";
import { findRepoRoot } from "./repo.js";

export const DEPLOY_CREDS_KEYS = ["HCLOUD_TOKEN", "GITHUB_TOKEN", "NIX_BIN", "SOPS_AGE_KEY_FILE"] as const;
export type DeployCredsKey = (typeof DEPLOY_CREDS_KEYS)[number];

export type DeployCredsEnvFileKeys = {
  HCLOUD_TOKEN: string;
  GITHUB_TOKEN: string;
  NIX_BIN: string;
  SOPS_AGE_KEY_FILE: string;
};

export type DeployEnvFileOrigin = "default" | "explicit";
export type DeployEnvFileStatus = "ok" | "missing" | "invalid";

export type DeployEnvFileInfo = {
  origin: DeployEnvFileOrigin;
  status: DeployEnvFileStatus;
  path: string;
  error?: string;
};

export type DeployCredsSource = "env" | "file" | "default" | "unset";

export type DeployCredsResult = {
  repoRoot: string;
  envFile?: DeployEnvFileInfo;
  envFromFile: Record<string, string>;
  values: {
    HCLOUD_TOKEN?: string;
    GITHUB_TOKEN?: string;
    NIX_BIN: string;
    SOPS_AGE_KEY_FILE?: string;
  };
  sources: Record<DeployCredsKey, DeployCredsSource>;
};

export function renderDeployCredsEnvFile(keys: DeployCredsEnvFileKeys): string {
  const lines = [
    "# clawdlets deploy creds (local-only; never commit)",
    "# Used by: bootstrap, infra, lockdown, doctor",
    "",
    `HCLOUD_TOKEN=${formatDotenvValue(keys.HCLOUD_TOKEN)}`,
    `GITHUB_TOKEN=${formatDotenvValue(keys.GITHUB_TOKEN)}`,
    `NIX_BIN=${formatDotenvValue(keys.NIX_BIN)}`,
    `SOPS_AGE_KEY_FILE=${formatDotenvValue(keys.SOPS_AGE_KEY_FILE)}`,
    "",
  ];
  return lines.join("\n");
}

function trimEnv(v: unknown): string | undefined {
  const trimmed = String(v ?? "").trim();
  return trimmed ? trimmed : undefined;
}

function validateEnvFileSecurity(filePath: string): { ok: true } | { ok: false; error: string } {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(filePath);
  } catch (e) {
    return { ok: false, error: `cannot stat: ${String((e as Error)?.message || e)}` };
  }

  if (st.isSymbolicLink()) return { ok: false, error: "refusing to load: is a symlink" };
  if (!st.isFile()) return { ok: false, error: "refusing to load: not a regular file" };

  const badPerms = (st.mode & 0o077) !== 0;
  if (badPerms) return { ok: false, error: `refusing to load: insecure permissions (mode ${(st.mode & 0o777).toString(8)}; expected 600)` };

  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (st.uid !== uid) return { ok: false, error: `refusing to load: wrong owner (uid ${st.uid}; expected ${uid})` };
  }

  return { ok: true };
}

function resolveEnvFile(params: { cwd: string; repoRoot: string; runtimeDir?: string; envFile?: string }):
  | { origin: DeployEnvFileOrigin; filePath: string; exists: boolean } {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);

  const explicit = trimEnv(params.envFile);
  if (explicit) {
    const expanded = expandPath(explicit);
    const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.cwd, expanded);
    return { origin: "explicit", filePath: abs, exists: fs.existsSync(abs) };
  }

  const abs = layout.envFilePath;
  return { origin: "default", filePath: abs, exists: fs.existsSync(abs) };
}

export function loadDeployCreds(params: { cwd: string; runtimeDir?: string; envFile?: string }): DeployCredsResult {
  const repoRoot = findRepoRoot(params.cwd);
  const resolved = resolveEnvFile({ cwd: params.cwd, repoRoot, runtimeDir: params.runtimeDir, envFile: params.envFile });

  let envFile: DeployEnvFileInfo | undefined;
  let envFromFile: Record<string, string> = {};

  if (resolved.exists) {
    const check = validateEnvFileSecurity(resolved.filePath);
    envFile = check.ok
      ? { origin: resolved.origin, status: "ok", path: resolved.filePath }
      : { origin: resolved.origin, status: "invalid", path: resolved.filePath, error: check.error };

    if (check.ok) {
      try {
        const raw = fs.readFileSync(resolved.filePath, "utf8");
        envFromFile = dotenv.parse(raw);
      } catch (e) {
        envFile = {
          origin: resolved.origin,
          status: "invalid",
          path: resolved.filePath,
          error: `cannot read/parse: ${String((e as Error)?.message || e)}`,
        };
        envFromFile = {};
      }
    }
  } else if (resolved.origin === "explicit") {
    envFile = { origin: resolved.origin, status: "missing", path: resolved.filePath, error: "file not found" };
  }

  const get = (k: DeployCredsKey): { value?: string; source: DeployCredsSource } => {
    const fromEnv = trimEnv(process.env[k]);
    if (fromEnv) return { value: fromEnv, source: "env" };

    const fromFile = trimEnv(envFromFile[k]);
    if (fromFile) return { value: fromFile, source: "file" };

    if (k === "NIX_BIN") return { value: "nix", source: "default" };
    return { value: undefined, source: "unset" };
  };

  const HCLOUD_TOKEN = get("HCLOUD_TOKEN");
  const GITHUB_TOKEN = get("GITHUB_TOKEN");
  const NIX_BIN = get("NIX_BIN");
  const SOPS_AGE_KEY_FILE = get("SOPS_AGE_KEY_FILE");

  const sopsAgeKeyFileRaw = SOPS_AGE_KEY_FILE.value ? expandPath(SOPS_AGE_KEY_FILE.value) : undefined;
  const sopsAgeKeyFile = sopsAgeKeyFileRaw
    ? (path.isAbsolute(sopsAgeKeyFileRaw) ? sopsAgeKeyFileRaw : path.resolve(repoRoot, sopsAgeKeyFileRaw))
    : undefined;

  return {
    repoRoot,
    envFile,
    envFromFile,
    values: {
      HCLOUD_TOKEN: HCLOUD_TOKEN.value,
      GITHUB_TOKEN: GITHUB_TOKEN.value,
      NIX_BIN: NIX_BIN.value || "nix",
      SOPS_AGE_KEY_FILE: sopsAgeKeyFile,
    },
    sources: {
      HCLOUD_TOKEN: HCLOUD_TOKEN.source,
      GITHUB_TOKEN: GITHUB_TOKEN.source,
      NIX_BIN: NIX_BIN.source,
      SOPS_AGE_KEY_FILE: SOPS_AGE_KEY_FILE.source,
    },
  };
}
