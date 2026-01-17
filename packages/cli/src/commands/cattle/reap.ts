import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { openCattleState } from "@clawdlets/core/lib/cattle-state";
import { buildCattleLabelSelector, reapExpiredCattle } from "@clawdlets/core/lib/hcloud-cattle";
import { loadHostContextOrExit } from "../../lib/context.js";
import { formatTable, requireEnabled, unixSecondsNow } from "./common.js";

export const cattleReap = defineCommand({
  meta: { name: "reap", description: "Destroy expired cattle servers (TTL enforcement)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    dryRun: { type: "boolean", description: "Print plan without deleting.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const now = unixSecondsNow();
    const res = await reapExpiredCattle({
      token: hcloudToken,
      labelSelector: buildCattleLabelSelector(),
      now: new Date(now * 1000),
      dryRun: args.dryRun,
    });
    const expired = res.expired;

    if (expired.length === 0) {
      console.log("ok: no expired cattle servers");
      return;
    }

    console.log(
      formatTable([
        ["ID", "NAME", "IDENTITY", "TASK", "EXPIRES", "STATUS"],
        ...expired.map((s) => [s.id, s.name, s.identity || "-", s.taskId || "-", String(Math.floor(s.expiresAt.getTime() / 1000)), s.status]),
      ]),
    );

    if (args.dryRun) return;

    const st = openCattleState(layout.cattleDbPath);
    try {
      for (const id of res.deletedIds) {
        st.markDeletedById(id, now);
      }
    } finally {
      st.close();
    }

    console.log(`ok: reaped ${res.deletedIds.length} cattle server(s)`);
  },
});

