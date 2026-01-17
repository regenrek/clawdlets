import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { buildCattleLabelSelector, listCattleServers } from "@clawdlets/core/lib/hcloud-cattle";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { loadHostContextOrExit } from "../../lib/context.js";
import { requireEnabled, resolveOne, resolveTailscaleIpv4 } from "./common.js";

export const cattleLogs = defineCommand({
  meta: { name: "logs", description: "Stream logs from a cattle VM over tailnet SSH." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    idOrName: { type: "string", description: "Cattle server id or name.", required: true },
    lines: { type: "string", description: "Number of lines (default: 200).", default: "200" },
    since: { type: "string", description: "Time window (journalctl syntax, e.g. '10m ago')." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const servers = await listCattleServers({ token: hcloudToken, labelSelector: buildCattleLabelSelector() });
    const server = resolveOne(servers, String((args as any).idOrName || ""));

    const ip = await resolveTailscaleIpv4(server.name);
    const targetHost = `admin@${ip}`;

    const n = String(args.lines || "200").trim() || "200";
    if (!/^\d+$/.test(n) || Number(n) <= 0) throw new Error(`invalid --lines: ${n}`);

    const since = args.since ? String(args.since).trim() : "";
    const remoteCmd = [
      "sudo",
      "journalctl",
      "-u",
      shellQuote("clawdlets-cattle.service"),
      "-n",
      shellQuote(n),
      ...(since ? ["--since", shellQuote(since)] : []),
      ...(args.follow ? ["-f"] : []),
      "--no-pager",
    ].join(" ");

    await sshRun(targetHost, remoteCmd, { redact: [] });
  },
});

