import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");

const outDir = path.join(pkgRoot, "dist", "template");
const skeletonDir = path.join(pkgRoot, "skeleton");

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isExcluded(rel) {
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.includes(".git")) return true;
  if (parts.includes(".clawdlets")) return true;
  if (parts.includes("node_modules")) return true;
  if (parts.includes(".terraform")) return true;
  if (rel.endsWith(".tfstate") || rel.endsWith(".tfstate.backup")) return true;
  if (rel.includes(".tfstate.")) return true;
  return false;
}

function copyTree(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const destPath = path.join(destDir, ent.name);
    const rel = path.relative(srcDir, srcPath);

    if (isExcluded(rel)) continue;

    if (ent.isDirectory()) {
      ensureDir(destPath);
      copyTree(srcPath, destPath);
      continue;
    }
    if (!ent.isFile()) continue;

    ensureDir(path.dirname(destPath));
    fs.copyFileSync(srcPath, destPath);
    const st = fs.statSync(srcPath);
    fs.chmodSync(destPath, st.mode & 0o777);
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  const st = fs.statSync(src);
  fs.chmodSync(dest, st.mode & 0o777);
}

function renderFlakeNix(params) {
  const raw = fs.readFileSync(params.srcPath, "utf8");
  const replaced = raw.replace(
    /^\s*description\s*=\s*".*?";/m,
    '  description = "__PROJECT_NAME__";',
  );
  if (replaced === raw) throw new Error(`unable to rewrite description in ${params.srcPath}`);
  ensureDir(path.dirname(params.destPath));
  fs.writeFileSync(params.destPath, replaced, "utf8");
}

function main() {
  rmrf(outDir);
  ensureDir(outDir);

  if (!fs.existsSync(skeletonDir)) throw new Error(`missing skeleton dir: ${skeletonDir}`);
  copyTree(skeletonDir, outDir);

  copyTree(path.join(repoRoot, "docs"), path.join(outDir, "docs"));
  copyTree(path.join(repoRoot, "infra"), path.join(outDir, "infra"));
  copyTree(path.join(repoRoot, "fleet"), path.join(outDir, "fleet"));
  if (fs.existsSync(path.join(repoRoot, "agent-playbooks"))) {
    copyTree(path.join(repoRoot, "agent-playbooks"), path.join(outDir, "agent-playbooks"));
  }

  ensureDir(path.join(outDir, "scripts"));
  for (const f of ["gh-sync.sh", "gh-sync-read.sh", "gh-mint-app-token.sh", "ops-snapshot.sh", "install-secrets.sh", "switch-system.sh", "seed-workspace.sh", "sync-managed-docs.sh", "secleak-check.sh"]) {
    copyFile(path.join(repoRoot, "scripts", f), path.join(outDir, "scripts", f));
  }

  renderFlakeNix({ srcPath: path.join(repoRoot, "flake.nix"), destPath: path.join(outDir, "flake.nix") });
  copyFile(path.join(repoRoot, "flake.lock"), path.join(outDir, "flake.lock"));

  const readme = path.join(outDir, "README.md");
  if (fs.existsSync(readme)) {
    const txt = fs.readFileSync(readme, "utf8");
    fs.writeFileSync(readme, txt.replace(/clawdlets-myproject/g, "__PROJECT_NAME__"), "utf8");
  }
}

main();
