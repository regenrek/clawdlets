import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { ClawdletsConfigSchema, loadClawdletsConfig, writeClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function validateBotId(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "bot id required";
  if (!/^[a-z][a-z0-9_-]*$/.test(v)) return "use: [a-z][a-z0-9_-]*";
  return undefined;
}

const list = defineCommand({
  meta: { name: "list", description: "List bots (from fleet/clawdlets.json)." },
  args: {},
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawdletsConfig({ repoRoot });
    console.log((config.fleet.botOrder || []).join("\n"));
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Add a bot id to fleet/clawdlets.json." },
  args: {
    bot: { type: "string", description: "Bot id (e.g. maren)." },
    interactive: { type: "boolean", description: "Prompt for missing inputs (requires TTY).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });

    let botId = String(args.bot || "").trim();
    if (!botId) {
      if (!args.interactive) throw new Error("missing --bot (or pass --interactive)");
      if (!process.stdout.isTTY) throw new Error("--interactive requires a TTY");
      p.intro("clawdlets bot add");
      const v = await p.text({ message: "Bot id", placeholder: "maren", validate: validateBotId });
      if (p.isCancel(v)) {
        const nav = await navOnCancel({ flow: "bot add", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      botId = String(v).trim();
    }

    const err = validateBotId(botId);
    if (err) throw new Error(err);

    const existingBots = config.fleet.botOrder;
    if (existingBots.includes(botId) || config.fleet.bots[botId]) {
      console.log(`ok: already present: ${botId}`);
      return;
    }

    const next = {
      ...config,
      fleet: {
        ...config.fleet,
        botOrder: [...existingBots, botId],
        bots: { ...config.fleet.bots, [botId]: {} },
      },
    };
    const validated = ClawdletsConfigSchema.parse(next);
    await writeClawdletsConfig({ configPath, config: validated });
    console.log(`ok: added bot ${botId}`);
  },
});

const rm = defineCommand({
  meta: { name: "rm", description: "Remove a bot id from fleet/clawdlets.json." },
  args: {
    bot: { type: "string", description: "Bot id to remove.", },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });
    const botId = String(args.bot || "").trim();
    if (!botId) throw new Error("missing --bot");
    const existingBots = config.fleet.botOrder;
    if (!existingBots.includes(botId) && !config.fleet.bots[botId]) throw new Error(`bot not found: ${botId}`);
    const nextBots = existingBots.filter((b) => b !== botId);
    const nextBotsRecord = { ...config.fleet.bots };
    delete (nextBotsRecord as any)[botId];
    const next = { ...config, fleet: { ...config.fleet, botOrder: nextBots, bots: nextBotsRecord } };
    const validated = ClawdletsConfigSchema.parse(next);
    await writeClawdletsConfig({ configPath, config: validated });
    console.log(`ok: removed bot ${botId}`);
  },
});

export const bot = defineCommand({
  meta: { name: "bot", description: "Manage fleet bots." },
  subCommands: { add, list, rm },
});
