import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { capture } from "@clawdbot/clawdlets-core/lib/run";
import { withFlakesEnv } from "@clawdbot/clawdlets-core/lib/nix-flakes";
import { getHostSecretsDir } from "@clawdbot/clawdlets-core/repo-layout";
import { createSecretsTar } from "@clawdbot/clawdlets-core/lib/secrets-tar";
import { loadHostContextOrExit } from "../../lib/context.js";
import { formatDeployManifest, requireToplevel, requireRev, type DeployManifest } from "../../lib/deploy-manifest.js";

async function buildToplevel(params: {
  repoRoot: string;
  nixBin: string;
  host: string;
}): Promise<string> {
  const attr = `.#packages.x86_64-linux.${params.host}-system`;
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

export const serverManifest = defineCommand({
  meta: {
    name: "manifest",
    description: "Build a deploy manifest (rev + toplevel + secrets digest).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    toplevel: { type: "string", description: "NixOS system toplevel store path (skip build)." },
    out: { type: "string", description: "Output manifest path (default: deploy-manifest.<host>.json)." },
    nixBin: { type: "string", description: "Override nix binary (default: nix)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, layout, hostName } = ctx;

    const revRaw = String(args.rev || "").trim() || "HEAD";
    const resolved = await resolveGitRev(layout.repoRoot, revRaw);
    if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);
    const rev = requireRev(resolved);

    const nixBin = String(args.nixBin || process.env.NIX_BIN || "nix").trim() || "nix";
    const toplevelArg = String(args.toplevel || "").trim();
    if (!toplevelArg && process.platform !== "linux") {
      throw new Error("manifest build requires Linux; pass --toplevel to skip local build");
    }
    const toplevel = toplevelArg ? requireToplevel(toplevelArg) : await buildToplevel({ repoRoot, nixBin, host: hostName });

    const secretsDir = getHostSecretsDir(layout, hostName);
    const { tarPath: tarLocal, digest } = await createSecretsTar({ hostName, localDir: secretsDir });
    try {
      const manifest: DeployManifest = { rev, host: hostName, toplevel, secretsDigest: digest };
      const outRaw = String(args.out || "").trim();
      const outPath = outRaw ? (path.isAbsolute(outRaw) ? outRaw : path.resolve(cwd, outRaw)) : path.join(cwd, `deploy-manifest.${hostName}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, formatDeployManifest(manifest), "utf8");
      console.log(`ok: wrote deploy manifest ${outPath}`);
    } finally {
      try {
        if (fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);
      } catch {
        // best-effort cleanup
      }
    }
  },
});
