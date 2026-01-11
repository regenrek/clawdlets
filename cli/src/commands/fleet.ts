import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { loadClawdletsConfig, writeClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";

const show = defineCommand({
  meta: { name: "show", description: "Print fleet config (from infra/configs/clawdlets.json)." },
  args: {},
  async run() {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawdletsConfig({ repoRoot });
    console.log(JSON.stringify(config.fleet, null, 2));
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set fleet config fields (in infra/configs/clawdlets.json)." },
  args: {
    "guild-id": { type: "string", description: "Discord guild/server id." },
    "codex-enable": { type: "string", description: "Enable codex (true/false)." },
    "restic-enable": { type: "string", description: "Enable restic backups (true/false)." },
    "restic-repository": { type: "string", description: "Restic repository URL/path." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });

    const next = JSON.parse(JSON.stringify(config)) as typeof config;

    if ((args as any)["guild-id"] !== undefined) next.fleet.guildId = String((args as any)["guild-id"]).trim();

    const parseBool = (v: unknown): boolean | undefined => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).trim().toLowerCase();
      if (s === "") return undefined;
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
      throw new Error(`invalid boolean: ${String(v)} (use true/false)`);
    };

    {
      const v = parseBool((args as any)["codex-enable"]);
      if (v !== undefined) next.fleet.codex.enable = v;
    }
    {
      const v = parseBool((args as any)["restic-enable"]);
      if (v !== undefined) next.fleet.backups.restic.enable = v;
    }

    if ((args as any)["restic-repository"] !== undefined) next.fleet.backups.restic.repository = String((args as any)["restic-repository"]).trim();

    await writeClawdletsConfig({ configPath, config: next });
    console.log("ok");
  },
});

export const fleet = defineCommand({
  meta: { name: "fleet", description: "Manage fleet config (infra/configs/clawdlets.json)." },
  subCommands: { show, set },
});
