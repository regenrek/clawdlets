import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { run } from "@clawdbot/clawdlets-core/lib/run";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { getHostRemoteSecretsDir, getHostSecretsDir } from "@clawdbot/clawdlets-core/repo-layout";
import { needsSudo, requireTargetHost } from "./common.js";
import { loadHostContextOrExit } from "../../lib/context.js";

export const secretsSync = defineCommand({
  meta: {
    name: "sync",
    description: "Copy local secrets file to the server filesystem path.",
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
    const { layout, hostName, hostCfg } = ctx;

    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const localDir = getHostSecretsDir(layout, hostName);
    if (!fs.existsSync(localDir)) throw new Error(`missing local secrets dir: ${localDir}`);

    const remoteDir = getHostRemoteSecretsDir(hostName);
    const tarLocal = path.join(os.tmpdir(), `clawdlets-secrets.${hostName}.${process.pid}.tgz`);
    const tarRemote = `/tmp/clawdlets-secrets.${hostName}.${process.pid}.tgz`;

    try {
      await run("tar", ["-C", localDir, "-czf", tarLocal, "."], { redact: [] });
      await run("scp", [tarLocal, `${targetHost}:${tarRemote}`], { redact: [] });
    } finally {
      try {
        if (fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);
      } catch {
        // best-effort cleanup
      }
    }

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
