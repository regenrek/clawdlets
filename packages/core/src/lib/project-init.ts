import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { downloadTemplate } from "giget";
import { ensureDir, writeFileAtomic } from "./fs-safe.js";
import { capture, run } from "./run.js";
import { assertSafeHostName } from "@clawdlets/shared/lib/identifiers";

type DownloadedTemplate = { dir: string };

function resolveLocalTemplateDir(templateSpec: string): string | null {
  const trimmed = String(templateSpec || "").trim();
  if (!trimmed.startsWith("file:")) return null;
  const dir = trimmed.slice("file:".length).trim();
  if (!dir) throw new Error("templateSpec file: missing path");
  return path.resolve(process.cwd(), dir);
}

function applySubs(s: string, subs: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(subs)) out = out.split(k).join(v);
  return out;
}

function isProbablyText(file: string): boolean {
  const base = path.basename(file);
  if (base === "Justfile" || base === "_gitignore") return true;
  const ext = path.extname(file).toLowerCase();
  return [
    ".md",
    ".nix",
    ".tf",
    ".hcl",
    ".json",
    ".yaml",
    ".yml",
    ".txt",
    ".lock",
    ".gitignore",
  ].includes(ext);
}

async function copyTree(params: {
  srcDir: string;
  destDir: string;
  subs: Record<string, string>;
}): Promise<void> {
  const entries = await fs.promises.readdir(params.srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const srcName = ent.name;
    const srcPath = path.join(params.srcDir, srcName);

    const renamed = srcName === "_gitignore" ? ".gitignore" : applySubs(srcName, params.subs);
    const destPath = path.join(params.destDir, renamed);

    if (ent.isDirectory()) {
      await ensureDir(destPath);
      await copyTree({ srcDir: srcPath, destDir: destPath, subs: params.subs });
      continue;
    }

    if (!ent.isFile()) continue;

    const buf = await fs.promises.readFile(srcPath);
    if (!isProbablyText(srcName)) {
      await ensureDir(path.dirname(destPath));
      await fs.promises.writeFile(destPath, buf);
      continue;
    }

    const rendered = applySubs(buf.toString("utf8"), params.subs);
    await writeFileAtomic(destPath, rendered);
  }
}

async function dirHasAnyFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function ensureHookExecutables(repoRoot: string): Promise<boolean> {
  const hooksDir = path.join(repoRoot, ".githooks");
  try {
    const entries = await fs.promises.readdir(hooksDir, { withFileTypes: true });
    let hasHooks = false;
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const p = path.join(hooksDir, ent.name);
      await fs.promises.chmod(p, 0o755);
      hasHooks = true;
    }
    return hasHooks;
  } catch {
    return false;
  }
}

async function findTemplateRoot(dir: string): Promise<string> {
  const direct = path.join(dir, "fleet", "clawdlets.json");
  if (fs.existsSync(direct)) return dir;

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const candidates: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(dir, ent.name);
    if (fs.existsSync(path.join(candidate, "fleet", "clawdlets.json"))) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  throw new Error(`template root missing fleet/clawdlets.json (searched: ${dir})`);
}

async function withDownloadedTemplate<T>(
  templateSpec: string,
  fn: (params: { templateDir: string; downloaded: DownloadedTemplate }) => Promise<T>,
): Promise<T> {
  const localDir = resolveLocalTemplateDir(templateSpec);
  if (localDir) {
    const stat = await fs.promises.stat(localDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`local template dir not found: ${localDir}`);
    }
    const templateDir = await findTemplateRoot(localDir);
    return await fn({ templateDir, downloaded: { dir: localDir } });
  }

  const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), "clawdlets-template-"));
  let templateDir = tempDir;
  try {
    const downloaded = await downloadTemplate(templateSpec, {
      dir: tempDir,
      force: true,
      auth: String(process.env["GITHUB_TOKEN"] || process.env["CLAWDLETS_TEMPLATE_TOKEN"] || "").trim() || undefined,
    });
    templateDir = await findTemplateRoot(downloaded.dir || tempDir);
    const result = await fn({ templateDir, downloaded: { dir: downloaded.dir || tempDir } });
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    return result;
  } catch (e) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

async function listPlannedFiles(params: {
  templateDir: string;
  subs: Record<string, string>;
}): Promise<string[]> {
  const planned: string[] = [];
  const walk = async (srcDir: string, rel: string) => {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const ent of entries) {
      const srcName = ent.name;
      const mapped = srcName === "_gitignore" ? ".gitignore" : applySubs(srcName, params.subs);
      const nextRel = path.join(rel, mapped);
      if (ent.isDirectory()) {
        await walk(path.join(srcDir, srcName), nextRel);
      } else if (ent.isFile()) {
        planned.push(nextRel);
      }
    }
  };
  await walk(params.templateDir, ".");
  planned.sort();
  return planned;
}

async function disableCacheNetrc(destDir: string, host: string): Promise<void> {
  const configPath = path.join(destDir, "fleet", "clawdlets.json");
  if (!fs.existsSync(configPath)) return;
  const raw = await fs.promises.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as any;
  const hostCfg = parsed?.hosts?.[host];
  if (!hostCfg || typeof hostCfg !== "object") return;
  hostCfg.cache = hostCfg.cache && typeof hostCfg.cache === "object" ? hostCfg.cache : {};
  hostCfg.cache.netrc = hostCfg.cache.netrc && typeof hostCfg.cache.netrc === "object" ? hostCfg.cache.netrc : {};
  hostCfg.cache.netrc.enable = false;
  await writeFileAtomic(configPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

export type ProjectInitPlan = {
  destDir: string;
  host: string;
  templateSpec: string;
  plannedFiles: string[];
};

export async function planProjectInit(params: {
  destDir: string;
  host: string;
  templateSpec: string;
}): Promise<ProjectInitPlan> {
  const destDir = path.resolve(process.cwd(), params.destDir);
  const host = String(params.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
  assertSafeHostName(host);

  const projectName = path.basename(destDir);
  const subs = {
    "__PROJECT_NAME__": projectName,
    "clawdbot-fleet-host": host,
    "clawdbot_fleet_host": host.replace(/-/g, "_"),
  };

  return await withDownloadedTemplate(params.templateSpec, async ({ templateDir }) => {
    const plannedFiles = await listPlannedFiles({ templateDir, subs });
    return {
      destDir,
      host,
      templateSpec: params.templateSpec,
      plannedFiles,
    };
  });
}

export type ProjectInitResult = {
  destDir: string;
  host: string;
  plannedFiles: string[];
  gitInitialized: boolean;
  hasHooks: boolean;
  nextSteps: string[];
};

export async function initProject(params: {
  destDir: string;
  host: string;
  templateSpec: string;
  gitInit?: boolean;
}): Promise<ProjectInitResult> {
  const destDir = path.resolve(process.cwd(), params.destDir);
  const host = String(params.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
  assertSafeHostName(host);

  const exists = fs.existsSync(destDir);
  if (exists && (await dirHasAnyFiles(destDir))) {
    throw new Error(`target dir not empty: ${destDir}`);
  }

  const projectName = path.basename(destDir);
  const subs = {
    "__PROJECT_NAME__": projectName,
    "clawdbot-fleet-host": host,
    "clawdbot_fleet_host": host.replace(/-/g, "_"),
  };

  const plannedFiles = await withDownloadedTemplate(params.templateSpec, async ({ templateDir }) => {
    const planned = await listPlannedFiles({ templateDir, subs });
    await ensureDir(destDir);
    await copyTree({ srcDir: templateDir, destDir, subs });
    await disableCacheNetrc(destDir, host);
    return planned;
  });

  const hasHooks = await ensureHookExecutables(destDir);
  const wantGitInit = params.gitInit ?? true;
  let gitInitialized = false;
  if (wantGitInit) {
    try {
      await capture("git", ["--version"], { cwd: destDir });
      await run("git", ["init"], { cwd: destDir });
      if (hasHooks) await run("git", ["config", "core.hooksPath", ".githooks"], { cwd: destDir });
      gitInitialized = true;
    } catch {
      gitInitialized = false;
    }
  }

  const nextSteps = [
    "next:",
    `- cd ${destDir}`,
    "- create a git repo + set origin (recommended; enables blank base flake)",
    "- clawdlets env init  # set HCLOUD_TOKEN in .clawdlets/env (required for provisioning)",
    `- clawdlets host set --host ${host} --admin-cidr <your-ip>/32 --disk-device /dev/sda --ssh-pubkey-file <path-to-your-key.pub> --add-ssh-key-file <path-to-your-key.pub>`,
    `- clawdlets host set --host ${host} --ssh-exposure bootstrap`,
    `- clawdlets secrets init --host ${host}`,
    `- clawdlets doctor --host ${host}`,
    `- clawdlets bootstrap --host ${host}`,
    `- clawdlets host set --host ${host} --target-host <ssh-alias|user@host>`,
    `- clawdlets host set --host ${host} --ssh-exposure tailnet`,
    `- clawdlets lockdown --host ${host}`,
  ];

  return {
    destDir,
    host,
    plannedFiles,
    gitInitialized,
    hasHooks,
    nextSteps,
  };
}
