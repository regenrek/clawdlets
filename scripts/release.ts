// @ts-nocheck
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Bump = "major" | "minor" | "patch" | string;

function die(msg: string): never {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function run(cmd: string): void {
  execSync(cmd, { stdio: "inherit", cwd: "." });
}

function sh(cmd: string): string {
  return execSync(cmd, { cwd: ".", stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

function ensureClean(): void {
  const s = sh("git status --porcelain");
  if (s) die("working tree not clean");
}

function ensureBranchMain(allowBranch: boolean): void {
  const b = sh("git rev-parse --abbrev-ref HEAD");
  if (!allowBranch && b !== "main") die(`current branch is '${b}' (expected 'main' or pass --allow-branch)`);
}

function parseBumpArg(v: string): Bump {
  const s = String(v || "").trim();
  if (!s) return "patch";
  if (s === "major" || s === "minor" || s === "patch") return s;
  return s;
}

function bumpSemver(current: string, bump: "major" | "minor" | "patch" | string): string {
  if (bump === "major" || bump === "minor" || bump === "patch") {
    const [maj0, min0, pat0] = current.split(".").map((n) => Number(n));
    if (!Number.isFinite(maj0) || !Number.isFinite(min0) || !Number.isFinite(pat0)) die(`invalid current version: ${current}`);
    if (bump === "major") return `${maj0 + 1}.0.0`;
    if (bump === "minor") return `${maj0}.${min0 + 1}.0`;
    return `${maj0}.${min0}.${pat0 + 1}`;
  }
  const next = bump.startsWith("v") ? bump.slice(1) : bump;
  if (!/^[0-9]+\\.[0-9]+\\.[0-9]+([.-][0-9A-Za-z.-]+)?$/.test(next)) die(`invalid version: ${bump}`);
  return next;
}

function bumpPackageVersion(pkgPath: string, nextVersion: string): void {
  const raw = fs.readFileSync(pkgPath, "utf8");
  const obj = JSON.parse(raw);
  obj.version = nextVersion;
  fs.writeFileSync(pkgPath, `${JSON.stringify(obj, null, 2)}\n`);
}

function ensureChangelogHasVersion(version: string): void {
  const p = path.resolve("CHANGELOG.md");
  if (!fs.existsSync(p)) die("missing CHANGELOG.md");
  const text = fs.readFileSync(p, "utf8");
  if (!new RegExp(`^## \\\\[${version.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\\\]`, "m").test(text)) {
    die(`CHANGELOG.md missing section: ## [${version}] - YYYY-MM-DD`);
  }
}

function ensureTagMissing(tag: string): void {
  try {
    execSync(`git rev-parse "${tag}"`, { stdio: "ignore" });
    die(`tag already exists: ${tag}`);
  } catch {
    // ok
  }
}

function main() {
  const args = process.argv.slice(2);

  const bumpArg = parseBumpArg(args[0] || "patch");
  const allowBranch = args.includes("--allow-branch");
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const noPush = args.includes("--no-push");
  const tagOnly = args.includes("--tag-only");

  if (args.includes("-h") || args.includes("--help")) {
    console.log(
      "Usage: pnpm dlx tsx scripts/release.ts <patch|minor|major|X.Y.Z> [--dry-run] [--allow-branch] [--no-push] [--tag-only]",
    );
    process.exit(0);
  }

  if (!dryRun) {
    ensureClean();
    ensureBranchMain(allowBranch);
  } else {
    // still validate branch, but don't block local iteration
    try {
      ensureBranchMain(allowBranch);
    } catch (e) {
      console.warn(String((e as Error)?.message || e));
    }
  }

  const cliPkgPath = path.resolve("cli/package.json");
  const corePkgPath = path.resolve("packages/core/package.json");
  const templatePkgPath = path.resolve("packages/template/package.json");

  for (const p of [cliPkgPath, corePkgPath, templatePkgPath]) {
    if (!fs.existsSync(p)) die(`missing package.json: ${p}`);
  }

  const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf8"));
  const current = String(cliPkg.version || "").trim();
  if (!current) die("cli/package.json missing version");

  const next = bumpSemver(current, bumpArg as any);
  const tag = `v${next}`;
  const willBump = !tagOnly && next !== current;

  ensureChangelogHasVersion(next);
  ensureTagMissing(tag);

  console.log(`Releasing ${tag}...`);

  // Gates always run (even on --dry-run) so "dry-run" still proves releasability.
  run("pnpm -r test");
  run("pnpm -r build");
  run("pnpm -C packages/core run coverage");
  run("scripts/secleak-check.sh");

  if (dryRun) {
    console.log(willBump ? "[dry-run] would bump versions + commit" : "[dry-run] no version bump/commit (tag-only)");
    console.log("[dry-run] would tag + push");
    return;
  }

  if (willBump) {
    bumpPackageVersion(cliPkgPath, next);
    bumpPackageVersion(corePkgPath, next);
    bumpPackageVersion(templatePkgPath, next);
    run("git add -A");
    run(`git commit -m "chore(release): ${tag}"`);
  } else {
    console.log(`No version bump/commit (current already ${current}; pass patch/minor/major or a new version to bump).`);
  }

  run(`git tag -a ${tag} -m "Release ${tag}"`);

  if (!noPush) {
    run("git push origin HEAD");
    run("git push origin --tags");
  } else {
    console.log("Skipping push (--no-push).");
  }

  console.log(`Release ready: ${tag}`);
  console.log("Next: GitHub Actions workflow 'release' (creates GitHub Release), then 'npm Release' (Trusted Publishing).");
}

main();
