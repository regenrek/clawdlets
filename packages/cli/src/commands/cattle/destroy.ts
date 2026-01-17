import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { safeCattleLabelValue } from "@clawdlets/core/lib/cattle-planner";
import { openCattleState } from "@clawdlets/core/lib/cattle-state";
import {
  CATTLE_LABEL_IDENTITY,
  buildCattleLabelSelector,
  destroyCattleServer,
  listCattleServers,
  type CattleServer,
} from "@clawdlets/core/lib/hcloud-cattle";
import { loadHostContextOrExit } from "../../lib/context.js";
import { formatTable, requireEnabled, resolveOne, unixSecondsNow } from "./common.js";

export const cattleDestroy = defineCommand({
  meta: { name: "destroy", description: "Destroy cattle servers (Hetzner delete)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    idOrName: { type: "string", description: "Cattle server id or name." },
    all: { type: "boolean", description: "Destroy all cattle servers.", default: false },
    identity: { type: "string", description: "Filter by identity (with --all)." },
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

    const identityFilterRaw = String(args.identity || "").trim();
    const identityFilter = identityFilterRaw ? safeCattleLabelValue(identityFilterRaw, "id") : "";

    const servers = await listCattleServers({
      token: hcloudToken,
      labelSelector: buildCattleLabelSelector(identityFilter ? { [CATTLE_LABEL_IDENTITY]: identityFilter } : {}),
    });

    const targets: CattleServer[] = [];
    if (args.all) {
      targets.push(...servers);
    } else {
      const idOrName = String(args.idOrName || "").trim();
      if (!idOrName) throw new Error("missing <idOrName> (or pass --all)");
      targets.push(resolveOne(servers, idOrName));
    }

    if (targets.length === 0) {
      console.log("ok: no matching cattle servers");
      return;
    }

    const st = openCattleState(layout.cattleDbPath);
    try {
      if (args.dryRun) {
        console.log(formatTable([["ID", "NAME", "IDENTITY", "TASK", "STATUS"], ...targets.map((s) => [s.id, s.name, s.identity || "-", s.taskId || "-", s.status])]));
        return;
      }

      const now = unixSecondsNow();
      for (const t of targets) {
        await destroyCattleServer({ token: hcloudToken, id: t.id });
        st.markDeletedById(t.id, now);
      }
    } finally {
      st.close();
    }

    console.log(`ok: destroyed ${targets.length} cattle server(s)`);
  },
});

