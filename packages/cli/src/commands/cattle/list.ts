import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { openCattleState } from "@clawdlets/core/lib/cattle-state";
import { buildCattleLabelSelector, listCattleServers, type CattleServer } from "@clawdlets/core/lib/hcloud-cattle";
import { loadHostContextOrExit } from "../../lib/context.js";
import { formatAgeSeconds, formatTable, requireEnabled, unixSecondsNow } from "./common.js";

export const cattleList = defineCommand({
  meta: { name: "list", description: "List active cattle servers (Hetzner + local state reconciliation)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
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

    const servers = await listCattleServers({ token: hcloudToken, labelSelector: buildCattleLabelSelector() });

    const now = unixSecondsNow();
    const byId = new Map<string, CattleServer>();
    for (const s of servers) byId.set(s.id, s);

    const st = openCattleState(layout.cattleDbPath);
    try {
      const activeLocal = st.listActive();
      const remoteIds = new Set<string>(servers.map((s) => s.id));
      for (const local of activeLocal) {
        if (!remoteIds.has(local.id)) st.markDeletedById(local.id, now);
      }

      for (const s of servers) {
        const existing = st.findActiveByIdOrName(s.id);
        st.upsertServer({
          id: s.id,
          name: s.name,
          identity: s.identity || existing?.identity || "",
          task: existing?.task || s.taskId || "",
          taskId: s.taskId || existing?.taskId || "",
          ttlSeconds: s.ttlSeconds,
          createdAt: Math.floor(s.createdAt.getTime() / 1000),
          expiresAt: Math.floor(s.expiresAt.getTime() / 1000),
          labels: s.labels || existing?.labels || {},
          lastStatus: s.status,
          lastIpv4: s.ipv4,
        });
      }
    } finally {
      st.close();
    }

    const sorted = [...servers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));

    if (args.json) {
      console.log(JSON.stringify({ servers: sorted }, null, 2));
      return;
    }

    const rows: string[][] = [
      ["ID", "NAME", "IDENTITY", "TASK", "STATUS", "TTL"],
      ...sorted.map((s) => {
        const ttlLeft = Math.max(0, Math.floor(s.expiresAt.getTime() / 1000) - now);
        return [s.id, s.name, s.identity || "-", s.taskId || "-", s.status, formatAgeSeconds(ttlLeft)];
      }),
    ];

    console.log(formatTable(rows));
  },
});

