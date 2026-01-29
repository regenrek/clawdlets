import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { BotIdSchema } from "@clawdlets/shared/lib/identifiers";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { buildClawdbotBotConfig } from "@clawdlets/core/lib/clawdbot-config-invariants";
import { needsSudo, requireTargetHost } from "../server/common.js";

function requireBotId(value: string): string {
  const botId = value.trim();
  const parsed = BotIdSchema.safeParse(botId);
  if (!parsed.success) throw new Error(`invalid --bot: ${botId}`);
  return botId;
}

function buildGatewaySchemaCommand(params: { botId: string; port: number; sudo: boolean }): string {
  const envFile = `/srv/clawdbot/${params.botId}/credentials/gateway.env`;
  const url = `ws://127.0.0.1:${params.port}`;
  const envFileQuoted = shellQuote(envFile);
  const tokenName = "CLAWDBOT_GATEWAY_TOKEN";
  const script = [
    "set -euo pipefail",
    `token=\"$(awk -F= '$1==\"${tokenName}\"{print substr($0,length($1)+2); exit}' ${envFileQuoted})\"`,
    'token="${token%$"\\r"}"',
    `if [ -z \"$token\" ]; then echo "missing ${tokenName}" >&2; exit 2; fi`,
    `env ${tokenName}=\"$token\" clawdbot gateway call config.schema --url ${url} --json`,
  ].join(" && ");
  const args = [
    ...(params.sudo ? ["sudo", "-u", `bot-${params.botId}`] : []),
    "bash",
    "-lc",
    script,
  ];
  return args.map((a) => shellQuote(a)).join(" ");
}

const schemaFetch = defineCommand({
  meta: { name: "fetch", description: "Fetch live Clawdbot config schema via gateway RPC." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    bot: { type: "string", description: "Bot id (fleet bot id; maps to systemd unit clawdbot-<bot>.service)." },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg, config } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);
    const botId = requireBotId(String(args.bot || ""));
    const botConfig = buildClawdbotBotConfig({ config, bot: botId });
    const gateway = (botConfig.invariants as any)?.gateway || {};
    const port = typeof gateway.port === "number" ? gateway.port : Number(gateway.port || 0);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`invalid gateway port for bot ${botId}`);
    }

    const remoteCmd = buildGatewaySchemaCommand({ botId, port, sudo: needsSudo(targetHost) });
    await sshRun(targetHost, remoteCmd, { tty: Boolean(args.sshTty) });
  },
});

export const clawdbotSchema = defineCommand({
  meta: { name: "schema", description: "Clawdbot config schema helpers." },
  subCommands: {
    fetch: schemaFetch,
  },
});
