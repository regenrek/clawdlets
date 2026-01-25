import fs from "node:fs";
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function getStagedPaths() {
  const out = git(["diff", "--cached", "--name-only", "-z"]);
  return out.split("\0").filter(Boolean);
}

function loadPatterns() {
  const file = ".forbidden-paths.regex";
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return lines.map((re) => new RegExp(re));
}

const staged = getStagedPaths();
if (staged.length === 0) process.exit(0);

const patterns = loadPatterns();
const blocked = staged.filter((p) => patterns.some((re) => re.test(p)));

if (blocked.length === 0) process.exit(0);

console.error("blocked: forbidden file(s) staged:");
for (const f of blocked) console.error(`- ${f}`);
console.error("");
console.error("fix: unstage/remove, or move to .clawdlets/ (ignored).");
console.error("If this is intentional, update .forbidden-paths.regex.");
process.exit(1);
