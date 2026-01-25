import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function getStagedPaths() {
  const out = git(["diff", "--cached", "--name-only", "-z"]);
  return out.split("\0").filter(Boolean);
}

function getIndexFileText(p) {
  return git(["show", `:${p}`]);
}

function isYamlSecretPath(p) {
  if (!p.startsWith("secrets/")) return false;
  if (p.endsWith("/.sops.yaml") || p === "secrets/.sops.yaml") return false;
  return p.endsWith(".yaml") || p.endsWith(".yml");
}

const staged = getStagedPaths().filter(isYamlSecretPath);
if (staged.length === 0) process.exit(0);

const failures = [];
for (const p of staged) {
  let txt = "";
  try {
    txt = getIndexFileText(p);
  } catch {
    continue;
  }
  const hasSopsMeta = /^sops:\s*$/m.test(txt);
  const hasEnc = /ENC\[[A-Z0-9_]+,data:/.test(txt);
  if (!hasSopsMeta || !hasEnc) failures.push(p);
}

if (failures.length === 0) process.exit(0);

console.error("blocked: secrets must be sops-encrypted (staged plaintext detected):");
for (const f of failures) console.error(`- ${f}`);
console.error("");
console.error("fix: encrypt with sops, then stage again (must contain sops: + ENC[...] payloads).");
process.exit(1);
