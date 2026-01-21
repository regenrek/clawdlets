import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { writeFileAtomic } from "@clawdlets/core/lib/fs-safe";
import { parseDotenv } from "@clawdlets/core/lib/dotenv-file";
import { expandPath } from "@clawdlets/core/lib/path-expand";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { loadDeployCreds, renderDeployCredsEnvFile, type DeployCredsEnvFileKeys } from "@clawdlets/core/lib/deploy-creds";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

function resolveEnvFilePath(params: { cwd: string; runtimeDir?: string; envFileArg?: unknown }): { path: string; origin: "default" | "explicit" } {
  const repoRoot = findRepoRoot(params.cwd);
  const explicit = String(params.envFileArg ?? "").trim();
  if (explicit) {
    const expanded = expandPath(explicit);
    const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.cwd, expanded);
    return { path: abs, origin: "explicit" };
  }
  const layout = getRepoLayout(repoRoot, params.runtimeDir);
  return { path: layout.envFilePath, origin: "default" };
}

function readEnvFileOrEmpty(filePath: string): { text: string; parsed: Record<string, string> } {
  if (!fs.existsSync(filePath)) return { text: "", parsed: {} };
  const st = fs.lstatSync(filePath);
  if (st.isSymbolicLink()) throw new Error(`refusing to read env file symlink: ${filePath}`);
  if (!st.isFile()) throw new Error(`refusing to read non-file env path: ${filePath}`);
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = parseDotenv(text);
  return { text, parsed };
}

export const envInit = defineCommand({
  meta: {
    name: "init",
    description: "Create/update <runtimeDir>/env for deploy creds (gitignored).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file path override (advanced; default: <runtimeDir>/env)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const layout = getRepoLayout(repoRoot, (args as any).runtimeDir);
    const resolved = resolveEnvFilePath({ cwd, runtimeDir: (args as any).runtimeDir, envFileArg: (args as any).envFile });

    if (resolved.origin === "default") {
      try {
        fs.mkdirSync(layout.runtimeDir, { recursive: true });
        fs.chmodSync(layout.runtimeDir, 0o700);
      } catch {
        // best-effort on platforms without POSIX perms
      }
    }

    const existing = readEnvFileOrEmpty(resolved.path).parsed;
    const keys: DeployCredsEnvFileKeys = {
      HCLOUD_TOKEN: String(existing.HCLOUD_TOKEN || "").trim(),
      GITHUB_TOKEN: String(existing.GITHUB_TOKEN || "").trim(),
      NIX_BIN: String(existing.NIX_BIN || "nix").trim() || "nix",
      SOPS_AGE_KEY_FILE: String(existing.SOPS_AGE_KEY_FILE || "").trim(),
    };

    await writeFileAtomic(resolved.path, renderDeployCredsEnvFile(keys), { mode: 0o600 });

    console.log(`ok: wrote ${path.relative(repoRoot, resolved.path) || resolved.path}`);
    if (resolved.origin === "explicit") {
      console.log(`note: you must pass --env-file ${resolved.path} to deploy commands to use it`);
    } else {
      console.log("next: edit this file and set HCLOUD_TOKEN (required)");
    }
  },
});

export const envShow = defineCommand({
  meta: {
    name: "show",
    description: "Show resolved deploy creds (redacted) + their sources (env/file/default).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const loaded = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });

    if (loaded.envFile) {
      const status = loaded.envFile.status;
      const detail = loaded.envFile.error ? ` (${loaded.envFile.error})` : "";
      console.log(`env file: ${status} (${loaded.envFile.origin}) ${loaded.envFile.path}${detail}`);
    } else {
      console.log("env file: (default missing; set vars via process env or run: clawdlets env init)");
    }

    const line = (k: "HCLOUD_TOKEN" | "GITHUB_TOKEN" | "NIX_BIN" | "SOPS_AGE_KEY_FILE", redact: boolean) => {
      const v = loaded.values[k];
      const src = loaded.sources[k];
      if (!v) return `${k}: unset (${src})`;
      if (redact) return `${k}: set (${src})`;
      return `${k}: ${v} (${src})`;
    };

    console.log(line("HCLOUD_TOKEN", true));
    console.log(line("GITHUB_TOKEN", true));
    console.log(line("NIX_BIN", false));
    console.log(line("SOPS_AGE_KEY_FILE", false));
  },
});

export const env = defineCommand({
  meta: {
    name: "env",
    description: "Local deploy credentials (.clawdlets/env).",
  },
  subCommands: {
    init: envInit,
    show: envShow,
  },
});
