import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { parseReleaseManifestFile } from "@clawdlets/core/lib/release-manifest";
import { run } from "@clawdlets/core/lib/run";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { getHostSecretsDir } from "@clawdlets/core/repo-layout";
import { createSecretsTar } from "@clawdlets/core/lib/secrets-tar";
import { requireDeployGate } from "../../lib/deploy-gate.js";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { needsSudo, requireTargetHost } from "../ssh-target.js";
import { resolveManifestPublicKeys, resolveManifestSignaturePath, verifyManifestSignature } from "../../lib/manifest-signature.js";

export const serverDeploy = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy a signed desired-state release manifest + secrets (reuses host-side updater apply path).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    manifest: { type: "string", description: "Path to release manifest JSON (required)." },
    manifestSignature: { type: "string", description: "Path to manifest minisign signature (.minisig)." },
    manifestPublicKey: { type: "string", description: "Minisign public key string (verify manifest)." },
    manifestPublicKeyFile: { type: "string", description: "Path to minisign public key (verify manifest)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, layout, hostName, hostCfg } = ctx;

    await requireDeployGate({
      runtimeDir: (args as any).runtimeDir,
      envFile: (args as any).envFile,
      host: hostName,
      scope: "server-deploy",
      strict: false,
      skipGithubTokenCheck: true,
    });

    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);
    const sudo = needsSudo(targetHost);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.origin === "explicit" && deployCreds.envFile.status !== "ok") {
      throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || deployCreds.envFile.status})`);
    }

    const manifestPathRaw = String(args.manifest || "").trim();
    if (!manifestPathRaw) throw new Error("missing --manifest");
    const manifestPath = path.isAbsolute(manifestPathRaw) ? manifestPathRaw : path.resolve(cwd, manifestPathRaw);

    const signaturePath = resolveManifestSignaturePath({
      cwd,
      manifestPath,
      signaturePathArg: (args as any).manifestSignature,
    });
    const publicKeys = resolveManifestPublicKeys({
      publicKeyArg: (args as any).manifestPublicKey,
      publicKeyFileArg: (args as any).manifestPublicKeyFile,
      defaultKeyPath: path.join(repoRoot, "config", "manifest.minisign.pub"),
      hostPublicKeys: hostCfg?.selfUpdate?.publicKeys,
    });
    await verifyManifestSignature({ manifestPath, signaturePath, publicKeys });

    const manifest = parseReleaseManifestFile(manifestPath);
    if (manifest.host !== hostName) {
      throw new Error(`manifest host mismatch: ${manifest.host} vs ${hostName}`);
    }
    const revArg = String(args.rev || "").trim();
    if (revArg && revArg !== "HEAD" && revArg !== manifest.rev) {
      throw new Error(`manifest rev mismatch: ${manifest.rev} vs ${revArg}`);
    }
    if (hostCfg?.selfUpdate?.enable) {
      const expectedChannel = String(hostCfg.selfUpdate.channel || "").trim();
      if (expectedChannel && manifest.channel !== expectedChannel) {
        throw new Error(`manifest channel mismatch: ${manifest.channel} vs ${expectedChannel}`);
      }
    }

    const secretsDir = getHostSecretsDir(layout, hostName);
    const { tarPath: tarLocal, digest } = await createSecretsTar({ hostName, localDir: secretsDir });
    const tarRemote = `/tmp/clawdlets-secrets.${hostName}.${process.pid}.tgz`;

    if (manifest.secrets.digest !== digest) {
      throw new Error(`secrets digest mismatch (manifest ${manifest.secrets.digest}, local ${digest}); rebuild release manifest`);
    }

    try {
      await run("scp", [tarLocal, `${targetHost}:${tarRemote}`], { redact: [] });
    } finally {
      try {
        if (fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);
      } catch {
        // best-effort cleanup
      }
    }

    const installCmd = [
      ...(sudo ? ["sudo"] : []),
      "/etc/clawdlets/bin/install-secrets",
      "--host",
      hostName,
      "--tar",
      tarRemote,
      "--rev",
      manifest.rev,
      "--digest",
      digest,
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, installCmd, { tty: sudo && args.sshTty });

    const remoteManifest = `/tmp/clawdlets-manifest.${hostName}.${process.pid}.json`;
    const remoteSig = `/tmp/clawdlets-manifest.${hostName}.${process.pid}.json.minisig`;

    await run("scp", [manifestPath, `${targetHost}:${remoteManifest}`], { redact: [] });
    await run("scp", [signaturePath, `${targetHost}:${remoteSig}`], { redact: [] });

    const ingestCmd = [
      ...(sudo ? ["sudo"] : []),
      "/etc/clawdlets/bin/update-ingest",
      "--manifest",
      remoteManifest,
      "--signature",
      remoteSig,
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, ingestCmd, { tty: sudo && args.sshTty });

    const applyCmd = [
      ...(sudo ? ["sudo"] : []),
      "/run/current-system/sw/bin/systemctl",
      "start",
      "clawdlets-update-apply.service",
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, applyCmd, { tty: sudo && args.sshTty });

    console.log(`ok: deployed desired state for ${hostName} releaseId=${manifest.releaseId} (${manifest.rev})`);
  },
});
