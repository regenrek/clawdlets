import process from "node:process";
import path from "node:path";
import { defineCommand } from "citty";
import { applySecurityDefaults } from "@clawdlets/core/lib/config-patch";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { ClawdletsConfigSchema, loadClawdletsConfigRaw, writeClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";

export const clawdbotHarden = defineCommand({
  meta: {
    name: "harden",
    description: "Apply safe Clawdbot security defaults to fleet/clawdlets.json (opt-in).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    bot: { type: "string", description: "Only apply hardening to this bot id." },
    write: { type: "boolean", description: "Apply changes to fleet/clawdlets.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config: raw } = loadClawdletsConfigRaw({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const validated = ClawdletsConfigSchema.parse(raw);

    const botArg = String(args.bot || "").trim();
    const bots = botArg ? [botArg] : validated.fleet.botOrder || [];
    if (bots.length === 0) throw new Error("fleet.botOrder is empty (set bots in fleet/clawdlets.json)");

    const next = structuredClone(validated) as any;

    const updates: Array<{ bot: string; changes: string[]; warnings: string[] }> = [];

    for (const bot of bots) {
      const botId = String(bot || "").trim();
      if (!botId) continue;
      const existing = next?.fleet?.bots?.[botId];
      if (!existing || typeof existing !== "object") throw new Error(`unknown bot id: ${botId}`);

      const patched = applySecurityDefaults({ clawdbot: (existing as any).clawdbot });
      if (patched.changes.length === 0) continue;

      (existing as any).clawdbot = patched.clawdbot;
      updates.push({
        bot: botId,
        changes: patched.changes.map((c) => c.path),
        warnings: patched.warnings,
      });
    }

    if (updates.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: Boolean(args.write), updates: [] }, null, 2));
      } else {
        console.log("ok: no security hardening changes needed");
      }
      return;
    }

    for (const u of updates) {
      for (const w of u.warnings) console.error(`warn: bot=${u.bot} ${w}`);
    }

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates }, null, 2));
        return;
      }
      console.log(`planned: update ${path.relative(repoRoot, configPath)}`);
      for (const u of updates) {
        for (const p of u.changes) console.log(`- fleet.bots.${u.bot}.clawdbot.${p}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const finalConfig = ClawdletsConfigSchema.parse(next);
    await writeClawdletsConfig({ configPath, config: finalConfig });

    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates }, null, 2));
      return;
    }

    console.log(`ok: updated ${path.relative(repoRoot, configPath)}`);
    for (const u of updates) {
      for (const p of u.changes) console.log(`- fleet.bots.${u.bot}.clawdbot.${p}`);
    }
  },
});

