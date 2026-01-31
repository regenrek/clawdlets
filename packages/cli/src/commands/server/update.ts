import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshCapture, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { needsSudo, requireTargetHost } from "./common.js";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";

function normalizeSince(value: string): string {
  const v = value.trim();
  const m = v.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return v;
  const n = Number(m[1]);
  const unit = String(m[2]).toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return v;
  if (unit === "s") return `${n} sec ago`;
  if (unit === "m") return `${n} min ago`;
  if (unit === "h") return `${n} hour ago`;
  if (unit === "d") return `${n} day ago`;
  return v;
}

const serverUpdateStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show updater status JSON (/var/lib/clawdlets/updates/status.json).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "/etc/clawdlets/bin/update-status",
    ].join(" ");
    const out = await sshCapture(targetHost, remoteCmd, { tty: sudo && args.sshTty });
    console.log(out);
  },
});

const serverUpdateLogs = defineCommand({
  meta: {
    name: "logs",
    description: "Show updater logs (journalctl -u clawdlets-update-*).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    lines: { type: "string", description: "Number of lines (default: 200).", default: "200" },
    since: { type: "string", description: "Time window (supports 5m/1h/2d or journalctl syntax)." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const since = args.since ? normalizeSince(String(args.since)) : "";
    const n = String(args.lines || "200").trim() || "200";
    if (!/^\d+$/.test(n) || Number(n) <= 0) throw new Error(`invalid --lines: ${n}`);

    const cmdArgs = [
      ...(sudo ? ["sudo"] : []),
      "journalctl",
      "-u",
      shellQuote("clawdlets-update-*"),
      "-n",
      shellQuote(n),
      ...(since ? ["--since", shellQuote(since)] : []),
      ...(args.follow ? ["-f"] : []),
      "--no-pager",
    ];
    const remoteCmd = cmdArgs.join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

export const serverUpdate = defineCommand({
  meta: {
    name: "update",
    description: "Host updater status + logs.",
  },
  subCommands: {
    status: serverUpdateStatus,
    logs: serverUpdateLogs,
  },
});

