import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { loadStack } from "@clawdbot/clawdlets-core/stack";

export const secretsPath = defineCommand({
  meta: {
    name: "path",
    description: "Print local + remote secrets paths for a host.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);
    console.log(`local: ${path.join(layout.stackDir, host.secrets.localDir)}`);
    console.log(`remote: ${host.secrets.remoteDir}`);
  },
});

