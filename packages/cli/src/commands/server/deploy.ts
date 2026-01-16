import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdlets/core/lib/git";
import { capture, run } from "@clawdlets/core/lib/run";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { withFlakesEnv } from "@clawdlets/core/lib/nix-flakes";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { getHostSecretsDir } from "@clawdlets/core/repo-layout";
import { createSecretsTar } from "@clawdlets/core/lib/secrets-tar";
import { requireDeployGate } from "../../lib/deploy-gate.js";
import { loadHostContextOrExit } from "../../lib/context.js";
import { needsSudo, requireTargetHost } from "../ssh-target.js";
import { formatDeployManifest, parseDeployManifest, requireToplevel, type DeployManifest } from "../../lib/deploy-manifest.js";
import { resolveManifestPublicKey, resolveManifestSignaturePath, verifyManifestSignature } from "../../lib/manifest-signature.js";
import { requireLinuxForLocalNixosBuild } from "../../lib/linux-build.js";


async function buildLocalToplevel(params: {
  repoRoot: string;
  nixBin: string;
  host: string;
}): Promise<string> {
  requireLinuxForLocalNixosBuild({ platform: process.platform, command: "clawdlets server deploy" });
  const attr = `.#nixosConfigurations.${params.host}.config.system.build.toplevel`;
  const out = await capture(params.nixBin, ["build", "--json", "--no-link", attr], {
    cwd: params.repoRoot,
    env: withFlakesEnv(process.env),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new Error(`nix build --json returned invalid JSON (${String((e as Error)?.message || e)})`);
  }
  const toplevel = (parsed as any)?.[0]?.outputs?.out;
  if (!toplevel || typeof toplevel !== "string") {
    throw new Error("nix build did not return a toplevel store path");
  }
  return requireToplevel(toplevel);
}

export const serverDeploy = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy a prebuilt NixOS system + secrets by store path.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    toplevel: { type: "string", description: "NixOS system toplevel store path (CI mode)." },
    manifest: { type: "string", description: "Path to deploy manifest JSON (CI mode)." },
    manifestSignature: { type: "string", description: "Path to manifest minisign signature (.minisig)." },
    manifestPublicKey: { type: "string", description: "Minisign public key string (verify manifest)." },
    manifestPublicKeyFile: { type: "string", description: "Path to minisign public key (verify manifest)." },
    manifestOut: { type: "string", description: "Write deploy manifest JSON to this path." },
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

    const nixBin = String(deployCreds.values.NIX_BIN || "nix").trim() || "nix";

    const manifestPath = String(args.manifest || "").trim();
    const toplevelArg = String(args.toplevel || "").trim();
    if (manifestPath && toplevelArg) throw new Error("use either --manifest or --toplevel (not both)");

    let resolvedRev = "";
    let toplevel = "";
    let manifestDigest: string | undefined;

    if (manifestPath) {
      const signaturePath = resolveManifestSignaturePath({
        cwd,
        manifestPath,
        signaturePathArg: args.manifestSignature,
      });
      const publicKey = resolveManifestPublicKey({
        publicKeyArg: args.manifestPublicKey,
        publicKeyFileArg: args.manifestPublicKeyFile,
        defaultKeyPath: path.join(repoRoot, "config", "manifest.minisign.pub"),
        hostPublicKey: hostCfg?.selfUpdate?.publicKey,
      });
      await verifyManifestSignature({ manifestPath, signaturePath, publicKey });

      const manifest = parseDeployManifest(manifestPath);
      if (manifest.host !== hostName) {
        throw new Error(`manifest host mismatch: ${manifest.host} vs ${hostName}`);
      }
      const revArg = String(args.rev || "").trim();
      if (revArg && revArg !== "HEAD" && revArg !== manifest.rev) {
        throw new Error(`manifest rev mismatch: ${manifest.rev} vs ${revArg}`);
      }
      resolvedRev = manifest.rev;
      toplevel = manifest.toplevel;
      manifestDigest = manifest.secretsDigest;
    } else {
      const revRaw = String(args.rev || "").trim() || "HEAD";
      const resolved = await resolveGitRev(layout.repoRoot, revRaw);
      if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);
      resolvedRev = resolved;

      if (toplevelArg) {
        toplevel = requireToplevel(toplevelArg);
      } else {
        const flakeHost = String(hostCfg.flakeHost || hostName).trim() || hostName;
        toplevel = await buildLocalToplevel({ repoRoot, nixBin, host: flakeHost });
      }
    }

    const secretsDir = getHostSecretsDir(layout, hostName);
    const { tarPath: tarLocal, digest } = await createSecretsTar({ hostName, localDir: secretsDir });
    const tarRemote = `/tmp/clawdlets-secrets.${hostName}.${process.pid}.tgz`;

    if (manifestDigest && manifestDigest !== digest) {
      throw new Error(`secrets digest mismatch (manifest ${manifestDigest}, local ${digest}); regenerate or omit secretsDigest`);
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
      resolvedRev,
      "--digest",
      digest,
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, installCmd, { tty: sudo && args.sshTty });

    const switchCmd = [
      ...(sudo ? ["sudo"] : []),
      "/etc/clawdlets/bin/switch-system",
      "--toplevel",
      toplevel,
      "--rev",
      resolvedRev,
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, switchCmd, { tty: sudo && args.sshTty });

    const manifestOutRaw = String(args.manifestOut || "").trim();
    const manifestOut = manifestOutRaw
      ? (path.isAbsolute(manifestOutRaw) ? manifestOutRaw : path.resolve(cwd, manifestOutRaw))
      : (manifestPath ? "" : path.join(layout.runtimeDir, "deploy.json"));

    if (manifestOut) {
      fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
      const manifest: DeployManifest = { rev: resolvedRev, host: hostName, toplevel, secretsDigest: digest };
      fs.writeFileSync(manifestOut, formatDeployManifest(manifest), "utf8");
      console.log(`ok: wrote deploy manifest ${manifestOut}`);
    }

    console.log(`ok: deployed ${hostName} (${resolvedRev})`);
  },
});
