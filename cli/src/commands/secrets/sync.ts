import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { run } from "@clawdbot/clawdlets-core/lib/run";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { loadStack } from "@clawdbot/clawdlets-core/stack";
import { needsSudo, requireTargetHost } from "./common.js";

export const secretsSync = defineCommand({
  meta: {
    name: "sync",
    description: "Copy local secrets file to the server filesystem path.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const localDir = path.join(layout.stackDir, host.secrets.localDir);
    if (!fs.existsSync(localDir)) throw new Error(`missing local secrets dir: ${localDir}`);

    const remoteDir = host.secrets.remoteDir;
    const tarLocal = path.join(os.tmpdir(), `clawdlets-secrets.${hostName}.${process.pid}.tgz`);
    const tarRemote = `/tmp/clawdlets-secrets.${hostName}.${process.pid}.tgz`;

    await run("tar", ["-C", localDir, "-czf", tarLocal, "."], { redact: [] });
    await run("scp", [tarLocal, `${targetHost}:${tarRemote}`], { redact: [] });
    if (fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);

    const sudo = needsSudo(targetHost);
    const installCmd = [
      ...(sudo ? ["sudo"] : []),
      "sh",
      "-lc",
      [
        `mkdir -p ${shellQuote(remoteDir)}`,
        `tmpdir="/tmp/clawdlets-secrets.${hostName}.${process.pid}.d"`,
        `mkdir -p "$tmpdir"`,
        `tar -xzf ${shellQuote(tarRemote)} -C "$tmpdir"`,
        `if find "$tmpdir" -type f ! -name '*.yaml' | head -n 1 | grep -q .; then echo "refusing to install non-yaml secrets" >&2; exit 1; fi`,
        `find "$tmpdir" -maxdepth 1 -type f -name '*.yaml' -print0 | while IFS= read -r -d '' f; do bn="$(basename "$f")"; install -m 0400 -o root -g root "$f" ${shellQuote(remoteDir)}/"$bn"; done`,
        `rm -f ${shellQuote(tarRemote)}`,
        `rm -rf "$tmpdir"`,
      ].join(" && "),
    ].join(" ");
    await sshRun(targetHost, installCmd, { tty: sudo && args.sshTty });

    console.log(`ok: synced secrets to ${remoteDir}`);
  },
});

