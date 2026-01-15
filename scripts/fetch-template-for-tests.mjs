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
  const libPath = path.join(repoRoot, "packages", "core", "dist", "lib", "template-source.js");
  if (!await fs.stat(libPath).then(() => true).catch(() => false)) {
    throw new Error("missing packages/core/dist (run pnpm -r build)");
  }
  return await import(pathToFileURL(libPath).href);
}

async function loadTemplateSource(repoRoot) {
  const configPath = path.join(repoRoot, "config", "template-source.json");
  const cfg = await readJson(configPath);
  const repo = process.env.CLAWDLETS_TEMPLATE_REPO || cfg.repo;
  const tplPath = process.env.CLAWDLETS_TEMPLATE_PATH || cfg.path;
  const ref = process.env.CLAWDLETS_TEMPLATE_REF || cfg.ref;
  const lib = await loadTemplateLib(repoRoot);
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
  const source = await loadTemplateSource(repoRoot);
  const existing = await readMetadata(destRoot);
  if (existing && existing.repo === source.repo && existing.path === source.path && existing.ref === source.ref) {
    return;
  }

  await fs.rm(destRoot, { recursive: true, force: true });
  await fs.mkdir(destRoot, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "clawdlets-template-"));
  try {
    const tarPath = path.join(tempDir, "template.tar.gz");
    const tarUrl = `https://codeload.github.com/${source.repo}/tar.gz/${source.ref}`;
    const res = await fetch(tarUrl);
    if (!res.ok) {
      throw new Error(`template download failed (${res.status} ${res.statusText})`);
    }
    if (!res.body) throw new Error("template download failed (empty body)");
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tarPath));

    const { stdout } = await exec("tar", ["-tzf", tarPath]);
    const firstLine = stdout.split("\n").find((line) => line.trim().length > 0);
    if (!firstLine) throw new Error("template archive was empty");
    const rootDir = firstLine.split("/")[0];
    if (!rootDir) throw new Error("template archive root not found");

    const pathParts = source.path.split("/").filter(Boolean);
    if (pathParts.length === 0) throw new Error(`template path resolved empty: ${source.path}`);
    const strip = 1 + pathParts.length;
    const archivePath = `${rootDir}/${pathParts.join("/")}`;

    await exec("tar", ["-xzf", tarPath, "-C", destRoot, "--strip-components", String(strip), archivePath]);

    const marker = path.join(destRoot, "fleet", "clawdlets.json");
    await fs.access(marker);
    await writeMetadata(destRoot, source);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

ensureTemplate().catch((err) => {
  console.error(`[template-test-fetch] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
