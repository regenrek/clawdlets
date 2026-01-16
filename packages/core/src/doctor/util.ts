import fs from "node:fs";
import path from "node:path";

export function dirHasAnyFile(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  const st = fs.statSync(dirPath);
  if (st.isFile()) return true;
  if (!st.isDirectory()) return true;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const p0 = path.join(dirPath, e.name);
    if (e.isFile()) return true;
    if (e.isSymbolicLink()) return true;
    if (e.isDirectory() && dirHasAnyFile(p0)) return true;
  }
  return false;
}

export function resolveTemplateRoot(repoRoot: string): string | null {
  const env = String(process.env["CLAWDLETS_TEMPLATE_DIR"] || "").trim();
  if (env) {
    const resolved = path.resolve(env);
    if (fs.existsSync(resolved)) return resolved;
  }

  const local = path.join(repoRoot, "packages", "template", "dist", "template");
  if (fs.existsSync(local)) return local;
  return null;
}

export function loadKnownBundledSkills(
  repoRoot: string,
  templateRoot?: string | null,
): { ok: boolean; skills: string[]; errors: string[] } {
  const repoPath = path.join(repoRoot, "fleet", "bundled-skills.json");
  const tplPath = templateRoot ? path.join(templateRoot, "fleet", "bundled-skills.json") : null;

  const errors: string[] = [];

  let repoText = "";
  let tplText = "";

  try {
    if (!fs.existsSync(repoPath)) throw new Error(`missing: ${repoPath}`);
    repoText = fs.readFileSync(repoPath, "utf8");
  } catch (e) {
    errors.push(String((e as Error)?.message || e));
  }

  if (tplPath) {
    try {
      if (!fs.existsSync(tplPath)) throw new Error(`missing: ${tplPath}`);
      tplText = fs.readFileSync(tplPath, "utf8");
    } catch (e) {
      errors.push(String((e as Error)?.message || e));
    }
  }

  if (repoText && tplText && repoText.trim() !== tplText.trim()) {
    const label = tplPath ? path.relative(repoRoot, tplPath) : "template";
    errors.push(`bundled skills mismatch: fleet/bundled-skills.json must match ${label}`);
  }

  if (!repoText) return { ok: false, skills: [], errors };

  try {
    const parsed = JSON.parse(repoText) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      errors.push("fleet/bundled-skills.json must be a JSON array of strings");
      return { ok: false, skills: [], errors };
    }

    const cleaned = parsed.map((s) => s.trim()).filter(Boolean);
    const uniq = Array.from(new Set(cleaned));
    if (uniq.length === 0) errors.push("fleet/bundled-skills.json must not be empty");
    return { ok: errors.length === 0, skills: uniq, errors };
  } catch (e) {
    errors.push(`invalid JSON: fleet/bundled-skills.json (${String((e as Error)?.message || e)})`);
    return { ok: false, skills: [], errors };
  }
}
