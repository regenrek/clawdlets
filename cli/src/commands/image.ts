import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { capture, run } from "@clawdbot/clawdlets-core/lib/run";
import { withFlakesEnv } from "@clawdbot/clawdlets-core/lib/nix-flakes";
import { loadDeployCreds } from "@clawdbot/clawdlets-core/lib/deploy-creds";
import { loadHostContextOrExit } from "../lib/context.js";

async function buildRawImage(params: { repoRoot: string; nixBin: string; host: string }): Promise<string> {
  if (process.platform !== "linux") {
    throw new Error("image build requires Linux; run in CI or a Linux builder");
  }
  const attr = `.#packages.x86_64-linux.${params.host}-image`;
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
  const imagePath = (parsed as any)?.[0]?.outputs?.out;
  if (!imagePath || typeof imagePath !== "string") {
    throw new Error("nix build did not return an image store path");
  }
  if (!fs.existsSync(imagePath)) throw new Error(`image path missing: ${imagePath}`);
  return imagePath;
}

const imageBuild = defineCommand({
  meta: {
    name: "build",
    description: "Build a raw NixOS image for a host (nixos-generators).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    rev: { type: "string", description: "Git rev to name the image (HEAD/sha/tag).", default: "HEAD" },
    out: { type: "string", description: "Output path (default: .clawdlets/images/<host>/clawdlets-<host>-<rev>.raw)." },
    nixBin: { type: "string", description: "Override nix binary (default: nix)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, layout, hostName } = ctx;

    const revRaw = String(args.rev || "").trim() || "HEAD";
    const resolved = await resolveGitRev(repoRoot, revRaw);
    if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);

    const nixBin = String(args.nixBin || process.env.NIX_BIN || "nix").trim() || "nix";
    const imagePath = await buildRawImage({ repoRoot, nixBin, host: hostName });

    const outRaw = String(args.out || "").trim();
    const outPath = outRaw
      ? (path.isAbsolute(outRaw) ? outRaw : path.resolve(cwd, outRaw))
      : path.join(layout.runtimeDir, "images", hostName, `clawdlets-${hostName}-${resolved}.raw`);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(imagePath, outPath);

    console.log(`ok: built raw image ${outPath}`);
  },
});

const imageUpload = defineCommand({
  meta: {
    name: "upload",
    description: "Upload a raw image to Hetzner using hcloud-upload-image.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    "image-url": { type: "string", description: "Public URL for the raw image (Hetzner must reach it)." },
    compression: { type: "string", description: "Compression type (none|gz|bz2|xz).", default: "none" },
    architecture: { type: "string", description: "Architecture (x86 or arm).", default: "x86" },
    location: { type: "string", description: "Hetzner location (default: host hetzner.location)." },
    name: { type: "string", description: "Image name override (optional)." },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
    bin: { type: "string", description: "Override hcloud-upload-image binary (default: hcloud-upload-image)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const imageUrl = String((args as any)["image-url"] || "").trim();
    if (!imageUrl) throw new Error("missing --image-url");

    const compression = String(args.compression || "").trim();
    const compressionArg = compression === "none" ? "" : compression;
    if (compressionArg && !["gz", "bz2", "xz"].includes(compressionArg)) {
      throw new Error("invalid --compression (expected none|gz|bz2|xz)");
    }

    const architecture = String(args.architecture || "").trim() || "x86";
    if (!["x86", "arm"].includes(architecture)) {
      throw new Error("invalid --architecture (expected x86|arm)");
    }

    const location = String(args.location || hostCfg.hetzner.location || "nbg1").trim() || "nbg1";
    const name = String(args.name || "").trim();
    const bin = String(args.bin || "hcloud-upload-image").trim() || "hcloud-upload-image";

    const cmd = ["upload", "--image-url", imageUrl, "--architecture", architecture, "--location", location];
    if (compressionArg) cmd.push("--compression", compressionArg);
    if (name) cmd.push("--name", name);

    await run(bin, cmd, {
      env: { ...process.env, HCLOUD_TOKEN: hcloudToken },
      dryRun: args.dryRun,
      redact: [hcloudToken],
    });

    console.log(`ok: upload complete for ${hostName}`);
    console.log(`hint: set hetzner.image in fleet/clawdlets.json to the new image ID/name`);
  },
});

export const image = defineCommand({
  meta: {
    name: "image",
    description: "Image build/upload helpers (Hetzner custom images).",
  },
  subCommands: {
    build: imageBuild,
    upload: imageUpload,
  },
});
