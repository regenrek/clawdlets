import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir, writeFileAtomic } from "@clawdlets/core/lib/fs-safe";
import { PersonaNameSchema } from "@clawdlets/shared/lib/identifiers";
import { findRepoRoot } from "@clawdlets/core/lib/repo";

function getPersonasDir(repoRoot: string): string {
  return path.join(repoRoot, "cattle", "personas");
}

const personaAdd = defineCommand({
  meta: { name: "add", description: "Create a cattle persona skeleton under cattle/personas/<name>/." },
  args: {
    name: { type: "string", description: "Persona name (safe: [a-z][a-z0-9_-]*).", required: true },
    force: { type: "boolean", description: "Overwrite existing files.", default: false },
    dryRun: { type: "boolean", description: "Print planned writes without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const name = PersonaNameSchema.parse(String(args.name || "").trim());

    const personasDir = getPersonasDir(repoRoot);
    const dir = path.join(personasDir, name);
    const soulPath = path.join(dir, "SOUL.md");
    const configPath = path.join(dir, "config.json");
    const skillsDir = path.join(dir, "skills");
    const memoryDir = path.join(dir, "memory");

    const soulText = `# ${name}\n\n- tone: (fill)\n- values: (fill)\n- constraints: (fill)\n`;
    const configJson = {
      schemaVersion: 1,
      model: { primary: "", fallbacks: [] as string[] },
      skills: { allowBundled: [] as string[] },
      defaults: { maxConcurrent: 1 },
    };

    const plannedWrites = [soulPath, configPath, skillsDir, memoryDir];
    if (args.dryRun) {
      for (const p of plannedWrites) console.log(`planned: ${path.relative(repoRoot, p)}`);
      return;
    }

    await ensureDir(skillsDir);
    await ensureDir(memoryDir);

    if (!args.force) {
      if (fs.existsSync(soulPath)) throw new Error(`already exists: ${soulPath} (pass --force to overwrite)`);
      if (fs.existsSync(configPath)) throw new Error(`already exists: ${configPath} (pass --force to overwrite)`);
    }

    await writeFileAtomic(soulPath, soulText.endsWith("\n") ? soulText : `${soulText}\n`);
    await writeFileAtomic(configPath, `${JSON.stringify(configJson, null, 2)}\n`);

    console.log(`ok: created cattle/personas/${name}`);
  },
});

const personaList = defineCommand({
  meta: { name: "list", description: "List cattle personas under cattle/personas/." },
  args: {
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const personasDir = getPersonasDir(repoRoot);
    const out: string[] = [];
    if (fs.existsSync(personasDir)) {
      for (const ent of fs.readdirSync(personasDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const name = ent.name;
        const ok = PersonaNameSchema.safeParse(name);
        if (!ok.success) continue;
        out.push(name);
      }
    }
    out.sort();

    if (args.json) console.log(JSON.stringify({ personas: out }, null, 2));
    else for (const n of out) console.log(n);
  },
});

export const cattlePersona = defineCommand({
  meta: { name: "persona", description: "Cattle persona registry helpers (cattle/personas/<name>/)." },
  subCommands: { add: personaAdd, list: personaList },
});
