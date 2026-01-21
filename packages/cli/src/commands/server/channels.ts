import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { BotIdSchema } from "@clawdlets/core/lib/identifiers";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { requireTargetHost, needsSudo } from "./common.js";

function requireBotId(value: string): string {
  const botId = value.trim();
  const parsed = BotIdSchema.safeParse(botId);
  if (!parsed.success) throw new Error(`invalid --bot: ${botId}`);
  return botId;
}

function runRemoteClawdbotChannels(params: {
  targetHost: string;
  sudo: boolean;
  botId: string;
  args: string[];
  sshTty: boolean;
}) {
  const remoteArgs = [
    ...(params.sudo ? ["sudo"] : []),
    "/etc/clawdlets/bin/clawdbot-channels",
    "--bot",
    params.botId,
    ...params.args,
  ];
  const remoteCmd = remoteArgs.map((a) => shellQuote(a)).join(" ");
  return sshRun(params.targetHost, remoteCmd, { tty: params.sshTty });
}

const serverChannelsStatus = defineCommand({
  meta: { name: "status", description: "Run `clawdbot channels status` on the host for a bot." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (fleet bot id; maps to systemd unit clawdbot-<bot>.service)." },
    probe: { type: "boolean", description: "Probe channel credentials.", default: false },
    timeout: { type: "string", description: "Timeout in ms.", default: "10000" },
    json: { type: "boolean", description: "Output JSON.", default: false },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const botId = requireBotId(String(args.bot || ""));
    await runRemoteClawdbotChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      botId,
      sshTty: Boolean(args.sshTty),
      args: [
        "status",
        ...(args.probe ? ["--probe"] : []),
        ...(args.timeout ? ["--timeout", String(args.timeout)] : []),
        ...(args.json ? ["--json"] : []),
      ],
    });
  },
});

const serverChannelsCapabilities = defineCommand({
  meta: { name: "capabilities", description: "Run `clawdbot channels capabilities` on the host for a bot." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (fleet bot id; maps to systemd unit clawdbot-<bot>.service)." },
    channel: { type: "string", description: "Channel id (discord|telegram|slack|whatsapp|...|all)." },
    account: { type: "string", description: "Account id (only with --channel)." },
    target: { type: "string", description: "Channel target for permission audit (Discord channel:<id>)." },
    timeout: { type: "string", description: "Timeout in ms.", default: "10000" },
    json: { type: "boolean", description: "Output JSON.", default: false },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const botId = requireBotId(String(args.bot || ""));
    await runRemoteClawdbotChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      botId,
      sshTty: Boolean(args.sshTty),
      args: [
        "capabilities",
        ...(args.channel ? ["--channel", String(args.channel)] : []),
        ...(args.account ? ["--account", String(args.account)] : []),
        ...(args.target ? ["--target", String(args.target)] : []),
        ...(args.timeout ? ["--timeout", String(args.timeout)] : []),
        ...(args.json ? ["--json"] : []),
      ],
    });
  },
});

const serverChannelsLogin = defineCommand({
  meta: { name: "login", description: "Run `clawdbot channels login` on the host for a bot." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (fleet bot id; maps to systemd unit clawdbot-<bot>.service)." },
    channel: { type: "string", description: "Channel alias (default: whatsapp)." },
    account: { type: "string", description: "Account id (accountId)." },
    verbose: { type: "boolean", description: "Verbose connection logs.", default: false },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const botId = requireBotId(String(args.bot || ""));
    await runRemoteClawdbotChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      botId,
      sshTty: Boolean(args.sshTty),
      args: [
        "login",
        ...(args.channel ? ["--channel", String(args.channel)] : []),
        ...(args.account ? ["--account", String(args.account)] : []),
        ...(args.verbose ? ["--verbose"] : []),
      ],
    });
  },
});

const serverChannelsLogout = defineCommand({
  meta: { name: "logout", description: "Run `clawdbot channels logout` on the host for a bot." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (fleet bot id; maps to systemd unit clawdbot-<bot>.service)." },
    channel: { type: "string", description: "Channel alias (default: whatsapp)." },
    account: { type: "string", description: "Account id (accountId)." },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const botId = requireBotId(String(args.bot || ""));
    await runRemoteClawdbotChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      botId,
      sshTty: Boolean(args.sshTty),
      args: [
        "logout",
        ...(args.channel ? ["--channel", String(args.channel)] : []),
        ...(args.account ? ["--account", String(args.account)] : []),
      ],
    });
  },
});

export const serverChannels = defineCommand({
  meta: { name: "channels", description: "Operate Clawdbot channels over SSH (status/login/logout/capabilities)." },
  subCommands: {
    status: serverChannelsStatus,
    capabilities: serverChannelsCapabilities,
    login: serverChannelsLogin,
    logout: serverChannelsLogout,
  },
});

