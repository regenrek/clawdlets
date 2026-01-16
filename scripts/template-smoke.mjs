#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function die(msg) {
  console.error(`template-smoke: ${msg}`);
  process.exit(1);
}

function hasBin(name) {
  try {
    execFileSync(name, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, {
    cwd: opts.cwd || repoRoot,
    env: opts.env || process.env,
    stdio: opts.stdio || "inherit",
  });
}

function runJson(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, {
    cwd: opts.cwd || repoRoot,
    env: opts.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`${cmd} returned invalid JSON (${String(e?.message || e)})`);
  }
}

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    keepTemp: args.has("--keep-temp"),
    skipNix: args.has("--skip-nix"),
    skipRemoteInit: args.has("--skip-remote-init"),
    templateLocalDir: process.env.CLAWDLETS_TEMPLATE_LOCAL_DIR || "",
  };
}

function resolveDefaultLocalTemplateDir() {
  const sibling = path.resolve(repoRoot, "..", "clawdlets-template", "templates", "default");
  if (fs.existsSync(sibling)) return sibling;
  return "";
}

function readTemplateSource() {
  const p = path.join(repoRoot, "config", "template-source.json");
  if (!fs.existsSync(p)) die(`missing ${p}`);
  const raw = fs.readFileSync(p, "utf8");
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== "object") die(`invalid JSON: ${p}`);
  const repo = String(obj.repo || "").trim();
  const tplPath = String(obj.path || "").trim();
  const ref = String(obj.ref || "").trim();
  if (!repo || !tplPath || !ref) die(`invalid template-source.json (expected repo/path/ref): ${p}`);
  return { repo, path: tplPath, ref };
}

function ensureEmptyDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  const entries = fs.readdirSync(dir);
  if (entries.length !== 0) die(`expected empty dir: ${dir}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log(
      [
        "Usage: node scripts/template-smoke.mjs [--skip-nix] [--skip-remote-init] [--keep-temp]",
        "",
        "Env:",
        "  CLAWDLETS_TEMPLATE_LOCAL_DIR  Optional local template dir to validate (defaults to ../clawdlets-template/templates/default if present).",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (!hasBin("pnpm")) die("missing pnpm");
  if (!hasBin("npm")) die("missing npm");

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-template-smoke-"));
  const tmpPkgDir = path.join(tmpBase, "npm", "clawdlets");
  const tmpPrefix = path.join(tmpBase, "npm-global");
  const tmpProject = path.join(tmpBase, "project");

  try {
    console.log(`template-smoke: tmp=${tmpBase}`);

    run("pnpm", ["-r", "build"]);
    run("node", ["scripts/prepare-package.mjs", "--out", tmpPkgDir]);

    const packed = runJson("npm", ["pack", "--json"], { cwd: tmpPkgDir });
    if (!Array.isArray(packed) || packed.length !== 1) die(`unexpected npm pack output: ${JSON.stringify(packed)}`);
    const tarballName = String(packed[0]?.filename || "").trim();
    if (!tarballName) die("npm pack did not return filename");
    const tarballPath = path.join(tmpPkgDir, tarballName);
    if (!fs.existsSync(tarballPath)) die(`missing packed tarball: ${tarballPath}`);

    run("npm", ["install", "-g", "--prefix", tmpPrefix, tarballPath], { cwd: tmpBase });

    const binDir = path.join(tmpPrefix, "bin");
    const bin = path.join(binDir, process.platform === "win32" ? "clawdlets.cmd" : "clawdlets");
    if (!fs.existsSync(bin)) die(`expected clawdlets bin at ${bin}`);

    const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` };
    run("clawdlets", ["--help"], { cwd: repoRoot, env });

    const localTemplateDir = (opts.templateLocalDir || resolveDefaultLocalTemplateDir()).trim();
    if (localTemplateDir && fs.existsSync(localTemplateDir)) {
      console.log(`template-smoke: doctor local template (${localTemplateDir})`);
      run("clawdlets", ["doctor", "--scope", "repo"], { cwd: localTemplateDir, env });
      if (!opts.skipNix && hasBin("nix")) {
        run("nix", ["flake", "check", "-L"], { cwd: localTemplateDir, env });
      }
    } else {
      console.log("template-smoke: local template dir not found; skipping local template checks");
    }

    if (!opts.skipRemoteInit) {
      const tpl = readTemplateSource();
      ensureEmptyDir(tmpProject);
      console.log(`template-smoke: project init (repo=${tpl.repo} path=${tpl.path} ref=${tpl.ref})`);
      run(
        "clawdlets",
        [
          "project",
          "init",
          "--dir",
          tmpProject,
          "--git-init",
          "false",
          "--template",
          tpl.repo,
          "--template-path",
          tpl.path,
          "--template-ref",
          tpl.ref,
        ],
        { cwd: repoRoot, env },
      );
      run("clawdlets", ["doctor", "--scope", "repo"], { cwd: tmpProject, env });
    }

    console.log("template-smoke: ok");
  } finally {
    if (opts.keepTemp) {
      console.log(`template-smoke: keep tmp dir: ${tmpBase}`);
    } else {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  }
}

main();

