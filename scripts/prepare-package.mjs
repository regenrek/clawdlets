#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function die(msg) {
  console.error(`prepare-package: ${msg}`);
  process.exit(1);
}

function rmForce(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function cpDir(src, dest) {
  rmForce(dest);
  fs.cpSync(src, dest, { recursive: true });
}

function cpDirDereference(src, dest) {
  rmForce(dest);
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function cpFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function removeTsBuildInfoFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      removeTsBuildInfoFiles(p);
      continue;
    }
    if (e.isFile() && e.name.endsWith(".tsbuildinfo")) rmForce(p);
  }
}

function resolveRepoSlugFromPackageJson(pkg) {
  const url = pkg?.repository?.url;
  if (!url) return "";
  const m = String(url).match(/github\.com\/(.+?)\.git$/);
  return m ? m[1] : "";
}

function rewriteReadmeForNpm(readme, repoSlug) {
  if (!repoSlug) return readme;
  return readme.replace(/\]\(\.\/public\//g, `](https://raw.githubusercontent.com/${repoSlug}/main/public/`);
}

function isWorkspaceProtocol(v) {
  return String(v || "").startsWith("workspace:");
}

function rewriteWorkspaceDeps(pkg, versionsByName, fallbackVersion) {
  const next = { ...pkg };
  const deps = { ...(next.dependencies || {}) };
  for (const [k, v] of Object.entries(deps)) {
    if (!isWorkspaceProtocol(v)) continue;
    const resolved = versionsByName.get(k) || fallbackVersion;
    deps[k] = resolved;
  }
  next.dependencies = deps;
  return next;
}

function main() {
  const args = process.argv.slice(2);
  let outDir = path.join(repoRoot, "dist", "npm", "clawdlets");

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out") {
      const v = args[i + 1];
      if (!v) die("missing value for --out");
      outDir = path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
      i += 1;
      continue;
    }
    if (a === "-h" || a === "--help") {
      console.log("Usage: node scripts/prepare-package.mjs [--out <dir>]");
      process.exit(0);
    }
    die(`unknown arg: ${a}`);
  }

  const cliDir = path.join(repoRoot, "packages", "cli");
  const cliPkgPath = path.join(cliDir, "package.json");
  if (!fs.existsSync(cliPkgPath)) die(`missing cli package.json at ${cliPkgPath}`);

  const coreDir = path.join(repoRoot, "packages", "core");
  const corePkgPath = path.join(coreDir, "package.json");
  const coreDistDir = path.join(coreDir, "dist");
  if (!fs.existsSync(corePkgPath)) die(`missing core package.json at ${corePkgPath}`);
  if (!fs.existsSync(coreDistDir)) die(`missing core dist/ (run build): ${coreDistDir}`);

  const clfQueueDir = path.join(repoRoot, "packages", "clf", "queue");
  const clfQueuePkgPath = path.join(clfQueueDir, "package.json");
  const clfQueueDistDir = path.join(clfQueueDir, "dist");
  if (!fs.existsSync(clfQueuePkgPath)) die(`missing clf-queue package.json at ${clfQueuePkgPath}`);
  if (!fs.existsSync(clfQueueDistDir)) die(`missing clf-queue dist/ (run build): ${clfQueueDistDir}`);

  const cliPkg = readJson(cliPkgPath);
  const corePkg = readJson(corePkgPath);
  const clfQueuePkg = readJson(clfQueuePkgPath);

  const cliVersion = String(cliPkg?.version || "").trim();
  if (!cliVersion) die("cli package.json missing version");

  const outPkgDir = outDir;
  rmForce(outPkgDir);
  ensureDir(outPkgDir);

  // Copy CLI build output.
  const cliDistDir = path.join(cliDir, "dist");
  if (!fs.existsSync(cliDistDir)) die(`missing cli dist/ (run build): ${cliDistDir}`);
  cpDir(cliDistDir, path.join(outPkgDir, "dist"));
  removeTsBuildInfoFiles(path.join(outPkgDir, "dist"));

  // README + LICENSE for npm page.
  const repoPkg = readJson(path.join(repoRoot, "package.json"));
  const repoSlug = resolveRepoSlugFromPackageJson(cliPkg) || resolveRepoSlugFromPackageJson(repoPkg);
  const readmeSrc = path.join(repoRoot, "README.md");
  if (fs.existsSync(readmeSrc)) {
    const readme = fs.readFileSync(readmeSrc, "utf8");
    fs.writeFileSync(path.join(outPkgDir, "README.md"), rewriteReadmeForNpm(readme, repoSlug));
  }
  const licenseSrc = path.join(repoRoot, "LICENSE");
  if (fs.existsSync(licenseSrc)) cpFile(licenseSrc, path.join(outPkgDir, "LICENSE"));

  // Bundle internal workspace deps into node_modules.
  const versionsByName = new Map([
    [String(corePkg.name), String(corePkg.version || cliVersion)],
    [String(clfQueuePkg.name), String(clfQueuePkg.version || cliVersion)],
  ]);

  const bundled = [String(corePkg.name), String(clfQueuePkg.name)];
  const nmRoot = path.join(outPkgDir, "node_modules");

  const coreOutDir = path.join(nmRoot, ...String(corePkg.name).split("/"));
  ensureDir(coreOutDir);
  writeJson(path.join(coreOutDir, "package.json"), rewriteWorkspaceDeps(corePkg, versionsByName, cliVersion));
  cpDir(coreDistDir, path.join(coreOutDir, "dist"));
  removeTsBuildInfoFiles(path.join(coreOutDir, "dist"));

  const clfQueueOutDir = path.join(nmRoot, ...String(clfQueuePkg.name).split("/"));
  ensureDir(clfQueueOutDir);
  writeJson(path.join(clfQueueOutDir, "package.json"), rewriteWorkspaceDeps(clfQueuePkg, versionsByName, cliVersion));
  cpDir(clfQueueDistDir, path.join(clfQueueOutDir, "dist"));
  removeTsBuildInfoFiles(path.join(clfQueueOutDir, "dist"));

  // Bundle runtime deps of the bundled workspace packages.
  // npm pack will treat these as part of the bundled closure; if they're missing,
  // installs can produce empty "invalid" node_modules entries.
  const bundleRuntimeDeps = (pkgDir, pkg) => {
    for (const [depName, depVersion] of Object.entries(pkg.dependencies || {})) {
      if (isWorkspaceProtocol(depVersion)) continue;
      const srcDepDir = path.join(pkgDir, "node_modules", ...String(depName).split("/"));
      if (!fs.existsSync(srcDepDir)) die(`missing installed dependency (run install): ${srcDepDir}`);
      const destDepDir = path.join(nmRoot, ...String(depName).split("/"));
      ensureDir(path.dirname(destDepDir));
      cpDirDereference(srcDepDir, destDepDir);
    }
  };
  bundleRuntimeDeps(coreDir, corePkg);
  bundleRuntimeDeps(clfQueueDir, clfQueuePkg);

  // Publishable package.json (no workspace: protocol).
  const nextCliPkg = { ...cliPkg };
  nextCliPkg.private = false;
  nextCliPkg.publishConfig = { ...(nextCliPkg.publishConfig || {}), access: "public" };
  nextCliPkg.files = Array.from(
    new Set(["dist", "README.md", "LICENSE", ...(Array.isArray(nextCliPkg.files) ? nextCliPkg.files : [])]),
  ).filter((x) => x !== "node_modules");

  nextCliPkg.bundledDependencies = Array.from(new Set([...(nextCliPkg.bundledDependencies || []), ...bundled]));

  const deps = { ...(nextCliPkg.dependencies || {}) };

  // Ensure runtime deps of bundled workspace packages are installed by npm.
  // Bundled dependencies' transitive deps are not installed automatically.
  for (const pkg of [corePkg, clfQueuePkg]) {
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      if (isWorkspaceProtocol(version)) continue;
      if (!deps[name]) deps[name] = version;
    }
  }

  for (const name of bundled) {
    deps[name] = versionsByName.get(name) || cliVersion;
  }
  nextCliPkg.dependencies = deps;

  // Guard: no workspace: protocol in output manifest.
  for (const [k, v] of Object.entries(nextCliPkg.dependencies || {})) {
    if (String(v).startsWith("workspace:")) die(`output package.json still contains workspace protocol: ${k}=${v}`);
  }

  writeJson(path.join(outPkgDir, "package.json"), nextCliPkg);

  console.log(`Prepared npm package dir: ${outPkgDir}`);
}

main();
