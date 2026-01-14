import fs from "node:fs";
import process from "node:process";
import { defineCommand } from "citty";
import { run } from "@clawdbot/clawdlets-core/lib/run";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { getHostRemoteSecretsDir, getHostSecretsDir } from "@clawdbot/clawdlets-core/repo-layout";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { createSecretsTar } from "../../lib/secrets-tar.js";
import { needsSudo, requireTargetHost } from "./common.js";
import { loadHostContextOrExit } from "../../lib/context.js";

export const secretsSync = defineCommand({
  meta: {
    name: "sync",
    description: "Copy local secrets to the server via the install-secrets allowlist.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    rev: { type: "string", description: "Git rev for secrets metadata (HEAD/sha/tag).", default: "HEAD" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, hostName, hostCfg } = ctx;

    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const localDir = getHostSecretsDir(layout, hostName);
    const remoteDir = getHostRemoteSecretsDir(hostName);
    const revRaw = String(args.rev || "").trim() || "HEAD";
    const resolved = await resolveGitRev(layout.repoRoot, revRaw);
    if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);

    const { tarPath: tarLocal, digest } = await createSecretsTar({ hostName, localDir });
    const tarRemote = `/tmp/clawdlets-secrets.${hostName}.${process.pid}.tgz`;

    try {
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
      "/etc/clawdlets/bin/install-secrets",
      "--host",
      hostName,
      "--tar",
      tarRemote,
      "--rev",
      resolved,
      "--digest",
      digest,
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, installCmd, { tty: sudo && args.sshTty });

    console.log(`ok: synced secrets to ${remoteDir}`);
  },
});
