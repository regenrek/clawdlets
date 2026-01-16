import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((raw) => JSON.parse(raw));
}

async function loadTemplateLib(repoRoot) {
  const libDir = path.join(repoRoot, "packages", "core", "dist", "lib");
  const sourcePath = path.join(libDir, "template-source.js");
  const testDirPath = path.join(libDir, "template-test-dir.js");
  const ok = await fs.stat(sourcePath).then(() => true).catch(() => false);
  const ok2 = await fs.stat(testDirPath).then(() => true).catch(() => false);
  if (!ok || !ok2) throw new Error("missing packages/core/dist (run pnpm -r build)");
  const source = await import(pathToFileURL(sourcePath).href);
  const testDir = await import(pathToFileURL(testDirPath).href);
  return { ...source, ...testDir };
}

async function loadTemplateSource(repoRoot, lib) {
  const configPath = path.join(repoRoot, "config", "template-source.json");
  const cfg = await readJson(configPath);
  const repo = process.env.CLAWDLETS_TEMPLATE_REPO || cfg.repo;
  const tplPath = process.env.CLAWDLETS_TEMPLATE_PATH || cfg.path;
  const ref = process.env.CLAWDLETS_TEMPLATE_REF || cfg.ref;
  return lib.normalizeTemplateSource({ repo, path: tplPath, ref });
}

async function readMetadata(destRoot) {
  const metaPath = path.join(destRoot, ".template-source.json");
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMetadata(destRoot, meta) {
  const metaPath = path.join(destRoot, ".template-source.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

async function ensureTemplate() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const destRoot = path.resolve(
    String(process.env.CLAWDLETS_TEMPLATE_TEST_DIR || path.join(repoRoot, "packages", "core", "tests", ".template")),
  );
  const lib = await loadTemplateLib(repoRoot);
  const safeDestRoot = lib.resolveTemplateTestDir({ repoRoot, destRoot });
  const source = await loadTemplateSource(repoRoot, lib);
  const tarCacheDir = path.join(repoRoot, ".cache", "template");
  const tarCachePath = path.join(tarCacheDir, `${source.ref}.tar.gz`);
  const existing = await readMetadata(safeDestRoot);
  if (existing && existing.repo === source.repo && existing.path === source.path && existing.ref === source.ref) {
    return;
  }

  await fs.rm(safeDestRoot, { recursive: true, force: true });
  await fs.mkdir(safeDestRoot, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "clawdlets-template-"));
  try {
    const tarPath = path.join(tempDir, "template.tar.gz");
    const tarUrl = `https://codeload.github.com/${source.repo}/tar.gz/${source.ref}`;

    const useCache = await fs.stat(tarCachePath).then(() => true).catch(() => false);
    if (useCache) {
      await fs.copyFile(tarCachePath, tarPath);
    } else {
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const res = await fetch(tarUrl, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) {
            throw new Error(`template download failed (${res.status} ${res.statusText})`);
          }
          if (!res.body) throw new Error("template download failed (empty body)");
          await pipeline(Readable.fromWeb(res.body), createWriteStream(tarPath));
          await fs.mkdir(tarCacheDir, { recursive: true });
          await fs.copyFile(tarPath, tarCachePath);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
      if (lastErr) throw lastErr;
    }

    const { stdout } = await exec("tar", ["-tzf", tarPath]);
    const firstLine = stdout.split("\n").find((line) => line.trim().length > 0);
    if (!firstLine) throw new Error("template archive was empty");
    const rootDir = firstLine.split("/")[0];
    if (!rootDir) throw new Error("template archive root not found");

    const pathParts = source.path.split("/").filter(Boolean);
    if (pathParts.length === 0) throw new Error(`template path resolved empty: ${source.path}`);
    const strip = 1 + pathParts.length;
    const archivePath = `${rootDir}/${pathParts.join("/")}`;

    await exec("tar", ["-xzf", tarPath, "-C", safeDestRoot, "--strip-components", String(strip), archivePath]);

    const marker = path.join(safeDestRoot, "fleet", "clawdlets.json");
    await fs.access(marker);
    await writeMetadata(safeDestRoot, source);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

ensureTemplate().catch((err) => {
  console.error(`[template-test-fetch] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
