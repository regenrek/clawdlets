import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { needsSudo, requireTargetHost } from "./common.js";
import { loadHostContextOrExit } from "../../lib/context.js";

function normalizeKind(raw: string): "prs" | "issues" {
  const v = raw.trim();
  if (v === "prs" || v === "issues") return v;
  throw new Error(`invalid --kind: ${raw} (expected prs|issues)`);
}

const serverGithubSyncStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show GitHub sync timers (clawdbot-gh-sync-*.timer).",
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
      "systemctl",
      "list-timers",
      "--all",
      "--no-pager",
      shellQuote("clawdbot-gh-sync-*.timer"),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverGithubSyncRun = defineCommand({
  meta: {
    name: "run",
    description: "Run a GitHub sync now (oneshot).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (default: all bots with sync enabled)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const bot = String(args.bot || "").trim();
    const unit = bot ? `clawdbot-gh-sync-${bot}.service` : "clawdbot-gh-sync-*.service";
    const sudo = needsSudo(targetHost);
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "start",
      shellQuote(unit),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverGithubSyncLogs = defineCommand({
  meta: {
    name: "logs",
    description: "Show GitHub sync logs (journalctl).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (required)." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
    lines: { type: "string", description: "Number of lines (default: 200).", default: "200" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const bot = String(args.bot || "").trim();
    if (!bot) throw new Error("missing --bot (example: --bot maren)");

    const sudo = needsSudo(targetHost);
    const unit = `clawdbot-gh-sync-${bot}.service`;
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "journalctl",
      "-u",
      shellQuote(unit),
      "--no-pager",
      "-n",
      shellQuote(String(args.lines || "200")),
      ...(args.follow ? ["-f"] : []),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverGithubSyncShow = defineCommand({
  meta: {
    name: "show",
    description: "Show the last synced snapshot (prs|issues) from bot workspace memory.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (required)." },
    kind: { type: "string", description: "Snapshot kind: prs|issues.", default: "prs" },
    lines: { type: "string", description: "Max lines to print (default: 200).", default: "200" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const bot = String(args.bot || "").trim();
    if (!bot) throw new Error("missing --bot (example: --bot maren)");
    const kind = normalizeKind(String(args.kind || "prs"));
    const n = String(args.lines || "200").trim() || "200";
    if (!/^\d+$/.test(n) || Number(n) <= 0) throw new Error(`invalid --lines: ${n}`);

    const sudo = needsSudo(targetHost);
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "/etc/clawdlets/bin/gh-sync-read",
      shellQuote(bot),
      shellQuote(kind),
      shellQuote(n),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

export const serverGithubSync = defineCommand({
  meta: {
    name: "github-sync",
    description: "GitHub inventory sync (systemd timers + logs + snapshots).",
  },
  subCommands: {
    status: serverGithubSyncStatus,
    run: serverGithubSyncRun,
    logs: serverGithubSyncLogs,
    show: serverGithubSyncShow,
  },
});
