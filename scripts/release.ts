import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type BumpKind = "major" | "minor" | "patch";
type BumpArg = BumpKind | string;

type ReleaseFlags = {
  allowBranch: boolean;
  dryRun: boolean;
  noPush: boolean;
  tagOnly: boolean;
};

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

function usageAndExit(code: number): never {
  console.log(
    [
      "Usage: pnpm dlx tsx scripts/release.ts <patch|minor|major|X.Y.Z> [flags]",
      "",
      "Flags:",
      "  --dry-run, -n        Run gates only; print actions; do not commit/tag/push",
      "  --allow-branch       Allow releasing from a non-main branch",
      "  --no-push            Create commit/tag locally but do not push",
      "  --tag-only           Only create an annotated tag for the current version (requires version arg == current)",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function ensureClean(): void {
  const s = sh("git status --porcelain");
  if (s) die("working tree not clean");
}

function ensureBranchMain(allowBranch: boolean): void {
  const b = sh("git rev-parse --abbrev-ref HEAD");
  if (!allowBranch && b !== "main") die(`current branch is '${b}' (expected 'main' or pass --allow-branch)`);
}

function parseBumpArg(v: string): BumpArg {
  const s = String(v || "").trim();
  if (!s) return "patch";
  if (s === "major" || s === "minor" || s === "patch") return s;
  return s;
}

function bumpSemver(current: string, bump: BumpArg): string {
  if (bump === "major" || bump === "minor" || bump === "patch") {
    const [maj0, min0, pat0] = current.split(".").map((n) => Number(n));
    if (!Number.isFinite(maj0) || !Number.isFinite(min0) || !Number.isFinite(pat0)) die(`invalid current version: ${current}`);
    if (bump === "major") return `${maj0 + 1}.0.0`;
    if (bump === "minor") return `${maj0}.${min0 + 1}.0`;
    return `${maj0}.${min0}.${pat0 + 1}`;
  }
  const next = bump.startsWith("v") ? bump.slice(1) : bump;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$/.test(next)) die(`invalid version: ${bump}`);
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
  const marker = `## [${version}]`;
  const hasVersion = text.split(/\r?\n/).some((line) => line.startsWith(marker));
  if (!hasVersion) {
    die(`CHANGELOG.md missing section: ## [${version}] - YYYY-MM-DD`);
  }
}

function ensureGitRemoteOrigin(): void {
  try {
    sh("git remote get-url origin");
  } catch {
    die("missing git remote 'origin'");
  }
}

function ensureUpToDateWithOriginMain(flags: ReleaseFlags): void {
  ensureGitRemoteOrigin();
  try {
    run("git fetch origin --tags");
  } catch (e) {
    die(`git fetch failed: ${(e as Error).message}`);
  }

  const b = sh("git rev-parse --abbrev-ref HEAD");
  if (b !== "main") return;

  const counts = sh("git rev-list --left-right --count origin/main...HEAD");
  const [behind, ahead] = counts.split(/\s+/).map((n) => Number(n));
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return;
  if (!flags.dryRun && behind > 0) die(`branch main is behind origin/main by ${behind} commit(s) (run: git pull)`);
}

function ensureTagMissingLocalAndRemote(tag: string): void {
  try {
    execSync(`git show-ref --tags --verify "refs/tags/${tag}"`, { stdio: "ignore" });
    die(`tag already exists locally: ${tag}`);
  } catch {
    // ok
  }

  try {
    const out = sh(`git ls-remote --tags origin "refs/tags/${tag}"`);
    if (out) die(`tag already exists on origin: ${tag}`);
  } catch (e) {
    die(`git ls-remote failed (origin tags): ${(e as Error).message}`);
  }
}

function parseFlags(argv: string[]): ReleaseFlags {
  return {
    allowBranch: argv.includes("--allow-branch"),
    dryRun: argv.includes("--dry-run") || argv.includes("-n"),
    noPush: argv.includes("--no-push"),
    tagOnly: argv.includes("--tag-only"),
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) usageAndExit(0);

  const bumpArg = parseBumpArg(args[0] || "patch");
  const flags = parseFlags(args);

  if (!flags.dryRun) {
    ensureClean();
    ensureBranchMain(flags.allowBranch);
  } else {
    // still validate branch, but don't block local iteration
    try {
      ensureBranchMain(flags.allowBranch);
    } catch (e) {
      console.warn(String((e as Error)?.message || e));
    }
  }

  const cliPkgPath = path.resolve("packages/cli/package.json");
  const corePkgPath = path.resolve("packages/core/package.json");
  const cliPkgGitPath = "packages/cli/package.json";
  const corePkgGitPath = "packages/core/package.json";

  for (const p of [cliPkgPath, corePkgPath]) {
    if (!fs.existsSync(p)) die(`missing package.json: ${p}`);
  }

  const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf8"));
  const current = String(cliPkg.version || "").trim();
  if (!current) die("packages/cli/package.json missing version");

  const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
  const coreCurrent = String(corePkg.version || "").trim();
  if (!coreCurrent) die("packages/core/package.json missing version");
  if (coreCurrent !== current) die(`version mismatch: cli=${current} core=${coreCurrent}`);

  const next = bumpSemver(current, bumpArg);
  const tag = `v${next}`;
  const willBump = !flags.tagOnly && next !== current;

  if (flags.tagOnly && next !== current) {
    die(`--tag-only requires version arg to equal current version (${current})`);
  }

  ensureChangelogHasVersion(next);
  ensureUpToDateWithOriginMain(flags);
  ensureTagMissingLocalAndRemote(tag);

  console.log(`Releasing ${tag}...`);

  // Gates always run (even on --dry-run) so "dry-run" still proves releasability.
  run("pnpm gate");
  run("scripts/secleak-check.sh");

  if (flags.dryRun) {
    console.log(willBump ? "[dry-run] would bump versions + commit" : "[dry-run] no version bump/commit (tag-only)");
    console.log("[dry-run] would tag + push");
    return;
  }

  if (willBump) {
    bumpPackageVersion(cliPkgPath, next);
    bumpPackageVersion(corePkgPath, next);
    run(`git add "${cliPkgGitPath}" "${corePkgGitPath}"`);
    run(`git commit -m "chore(release): ${tag}"`);
  } else {
    console.log(`No version bump/commit (current already ${current}; pass patch/minor/major or a new version to bump).`);
  }

  const postCommitStatus = sh("git status --porcelain");
  if (postCommitStatus) die(`unexpected working tree changes after commit:\n${postCommitStatus}`);

  run(`git tag -a ${tag} -m "Release ${tag}"`);

  if (!flags.noPush) {
    run("git push origin HEAD");
    run(`git push origin "${tag}"`);
  } else {
    console.log("Skipping push (--no-push).");
  }

  console.log(`Release ready: ${tag}`);
  console.log("Next: GitHub Actions workflow 'release' (creates GitHub Release), then 'npm Release' (Trusted Publishing).");
}

main();
