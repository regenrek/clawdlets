import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir, writeFileAtomic } from "@clawdlets/core/lib/fs-safe";
import { IdentityNameSchema } from "@clawdlets/core/lib/identifiers";
import { findRepoRoot } from "@clawdlets/core/lib/repo";

function getIdentitiesDir(repoRoot: string): string {
  return path.join(repoRoot, "identities");
}

const identityAdd = defineCommand({
  meta: { name: "add", description: "Create an identity skeleton under identities/<name>/." },
  args: {
    name: { type: "string", description: "Identity name (safe: [a-z][a-z0-9_-]*).", required: true },
    force: { type: "boolean", description: "Overwrite existing files.", default: false },
    dryRun: { type: "boolean", description: "Print planned writes without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const name = IdentityNameSchema.parse(String(args.name || "").trim());

    const identitiesDir = getIdentitiesDir(repoRoot);
    const dir = path.join(identitiesDir, name);
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

    console.log(`ok: created identities/${name}`);
  },
});

const identityList = defineCommand({
  meta: { name: "list", description: "List identities under identities/." },
  args: {
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const identitiesDir = getIdentitiesDir(repoRoot);
    const out: string[] = [];
    if (fs.existsSync(identitiesDir)) {
      for (const ent of fs.readdirSync(identitiesDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const name = ent.name;
        const ok = IdentityNameSchema.safeParse(name);
        if (!ok.success) continue;
        out.push(name);
      }
    }
    out.sort();

    if (args.json) console.log(JSON.stringify({ identities: out }, null, 2));
    else for (const n of out) console.log(n);
  },
});

export const identity = defineCommand({
  meta: { name: "identity", description: "Identity registry helpers (identities/<name>/)." },
  subCommands: { add: identityAdd, list: identityList },
});

