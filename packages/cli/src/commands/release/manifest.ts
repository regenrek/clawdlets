import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdlets/core/lib/git";
import { getHostSecretsDir } from "@clawdlets/core/repo-layout";
import { createSecretsTar } from "@clawdlets/core/lib/secrets-tar";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { formatReleaseManifest, parseReleaseManifestFile, ReleaseManifestV1Schema } from "@clawdlets/core/lib/release-manifest";
import { buildHostSystemToplevelFromPackage } from "../../lib/nix-toplevel.js";
import { requireLinuxForLocalNixosBuild } from "../../lib/linux-build.js";
import { resolveManifestPublicKeys, resolveManifestSignaturePath, signFileWithMinisign, verifyManifestSignature } from "../../lib/manifest-signature.js";

function requireChannel(value: string): string {
  const v = value.trim();
  if (!v) throw new Error("missing --channel");
  if (!/^[a-z][a-z0-9-]*$/.test(v)) throw new Error(`invalid --channel: ${v} (use [a-z][a-z0-9-]*)`);
  return v;
}

function requireSystem(value: string): string {
  const v = value.trim();
  if (!v) throw new Error("missing --system");
  if (!/^[a-z0-9_]+-[a-z0-9_]+$/.test(v)) throw new Error(`invalid --system: ${v} (expected nix system like x86_64-linux)`);
  return v;
}

function requireReleaseId(value: string): number {
  const v = value.trim();
  if (!v) throw new Error("missing --release-id");
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid --release-id: ${v} (expected positive integer)`);
  return n;
}

function toPathFromCwd(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function expandDigestTemplate(template: string, digest: string): string {
  return template.includes("{digest}") ? template.replaceAll("{digest}", digest) : template;
}

const manifestBuild = defineCommand({
  meta: {
    name: "build",
    description: "Build a signed desired-state release manifest (v1).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    channel: { type: "string", description: "Release channel (staging|prod|...)." },
    system: { type: "string", description: "Nix system (x86_64-linux).", default: "x86_64-linux" },
    releaseId: { type: "string", description: "Monotonic issuance id for this host+channel (integer)." },
    issuedAt: { type: "string", description: "RFC3339/ISO8601 timestamp (default: now)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    toplevel: { type: "string", description: "NixOS system toplevel store path (skip build)." },
    nixBin: { type: "string", description: "Override nix binary (default: nix)." },
    out: { type: "string", description: "Output manifest path (default: deploy/<host>/<channel>/<releaseId>.json)." },
    secretsUrl: { type: "string", description: "Optional URL/path to encrypted secrets bundle (supports {digest} template)." },
    secretsFormat: { type: "string", description: "Secrets bundle format (required if --secrets-url is set)." },
    secretsBundleOut: { type: "string", description: "Optional output path for the encrypted secrets bundle (.tgz) (supports {digest} template)." },
    requiredFeature: { type: "string", description: "Required updater feature flag (repeatable).", array: true },
    minUpdaterVersion: { type: "string", description: "Minimum updater semver (exclusive with required features)." },
    cacheSubstituter: { type: "string", description: "Substituter URL (repeatable).", array: true },
    cacheTrustedKey: { type: "string", description: "Trusted public key (repeatable).", array: true },
    cacheNarinfoCachePositiveTtl: { type: "string", description: "narinfo-cache-positive-ttl (seconds)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, layout, hostName } = ctx;

    const channel = requireChannel(String(args.channel || ""));
    const system = requireSystem(String(args.system || "x86_64-linux"));
    const releaseId = requireReleaseId(String((args as any).releaseId || ""));

    const issuedAt = String(args.issuedAt || "").trim() || new Date().toISOString();

    const minUpdaterVersion = String(args.minUpdaterVersion || "").trim();
    const requiredFeatures = Array.isArray((args as any).requiredFeature)
      ? (args as any).requiredFeature.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];

    if (minUpdaterVersion && requiredFeatures.length > 0) {
      throw new Error("use either --min-updater-version or --required-feature (not both)");
    }

    const revRaw = String(args.rev || "").trim() || "HEAD";
    const resolved = await resolveGitRev(layout.repoRoot, revRaw);
    if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);

    const nixBin = String(args.nixBin || process.env.NIX_BIN || "nix").trim() || "nix";
    const toplevelArg = String(args.toplevel || "").trim();
    if (!toplevelArg) {
      requireLinuxForLocalNixosBuild({ platform: process.platform, command: "clawdlets release manifest build" });
    }
    const toplevel = toplevelArg
      ? String(toplevelArg)
      : await buildHostSystemToplevelFromPackage({ repoRoot, nixBin, system, host: hostName });

    const secretsDir = getHostSecretsDir(layout, hostName);
    const { tarPath: tarLocal, digest } = await createSecretsTar({ hostName, localDir: secretsDir });

    const secretsUrlRaw = String(args.secretsUrl || "").trim();
    const secretsUrl = secretsUrlRaw ? expandDigestTemplate(secretsUrlRaw, digest) : "";
    const secretsFormat = String(args.secretsFormat || "").trim();

    const bundleOutRaw = String(args.secretsBundleOut || "").trim();
    const bundleOut = bundleOutRaw ? toPathFromCwd(cwd, expandDigestTemplate(bundleOutRaw, digest)) : "";

    try {
      if (bundleOut) {
        fs.mkdirSync(path.dirname(bundleOut), { recursive: true });
        fs.renameSync(tarLocal, bundleOut);
      }

      const manifest = ReleaseManifestV1Schema.parse({
        schemaVersion: 1,
        host: hostName,
        system,
        channel,
        releaseId,
        issuedAt,
        ...(minUpdaterVersion ? { minUpdaterVersion } : {}),
        ...(requiredFeatures.length > 0 ? { requiredFeatures } : {}),
        rev: resolved,
        toplevel,
        secrets: {
          digest,
          ...(secretsUrl ? { url: secretsUrl } : {}),
          ...(secretsFormat ? { format: secretsFormat } : {}),
        },
        cache:
          Array.isArray((args as any).cacheSubstituter) || Array.isArray((args as any).cacheTrustedKey) || (args as any).cacheNarinfoCachePositiveTtl
            ? {
                substituters: Array.isArray((args as any).cacheSubstituter)
                  ? (args as any).cacheSubstituter.map((x: unknown) => String(x).trim()).filter(Boolean)
                  : [],
                trustedPublicKeys: Array.isArray((args as any).cacheTrustedKey)
                  ? (args as any).cacheTrustedKey.map((x: unknown) => String(x).trim()).filter(Boolean)
                  : [],
                ...(String((args as any).cacheNarinfoCachePositiveTtl || "").trim()
                  ? { narinfoCachePositiveTtl: Number(String((args as any).cacheNarinfoCachePositiveTtl).trim()) }
                  : {}),
              }
            : undefined,
      });

      const outRaw = String(args.out || "").trim();
      const outPath = outRaw
        ? toPathFromCwd(cwd, outRaw)
        : path.join(cwd, "deploy", hostName, channel, `${String(releaseId)}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, formatReleaseManifest(manifest), "utf8");
      console.log(`ok: wrote release manifest ${outPath}`);
    } finally {
      try {
        if (!bundleOut && fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);
      } catch {
        // best-effort cleanup
      }
    }
  },
});

const manifestSign = defineCommand({
  meta: {
    name: "sign",
    description: "Sign a release manifest or pointer with minisign.",
  },
  args: {
    in: { type: "string", description: "Input file path (manifest/pointer JSON)." },
    out: { type: "string", description: "Output signature path (default: <in>.minisig)." },
    privateKeyFile: { type: "string", description: "Path to minisign secret key file (minisign.key)." },
    privateKeyEnv: { type: "string", description: "Env var name containing minisign secret key contents (default: MINISIGN_PRIVATE_KEY)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const inRaw = String((args as any).in || "").trim();
    if (!inRaw) throw new Error("missing --in");
    const inPath = toPathFromCwd(cwd, inRaw);

    const outRaw = String((args as any).out || "").trim();
    const sigPath = outRaw ? toPathFromCwd(cwd, outRaw) : `${inPath}.minisig`;
    fs.mkdirSync(path.dirname(sigPath), { recursive: true });

    await signFileWithMinisign({
      filePath: inPath,
      signaturePath: sigPath,
      privateKeyFile: (args as any).privateKeyFile,
      privateKeyEnv: (args as any).privateKeyEnv,
    });
    console.log(`ok: wrote signature ${sigPath}`);
  },
});

const manifestVerify = defineCommand({
  meta: {
    name: "verify",
    description: "Verify a release manifest or pointer signature (minisign).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    in: { type: "string", description: "Input file path (manifest/pointer JSON)." },
    signature: { type: "string", description: "Signature path override (default: <in>.minisig)." },
    publicKey: { type: "string", description: "Minisign public key string (verify)." },
    publicKeyFile: { type: "string", description: "Path to minisign public key file (verify)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, hostCfg } = ctx;

    const inRaw = String((args as any).in || "").trim();
    if (!inRaw) throw new Error("missing --in");
    const inPath = toPathFromCwd(cwd, inRaw);

    const signaturePath = resolveManifestSignaturePath({
      cwd,
      manifestPath: inPath,
      signaturePathArg: (args as any).signature,
    });
    const publicKeys = resolveManifestPublicKeys({
      publicKeyArg: (args as any).publicKey,
      publicKeyFileArg: (args as any).publicKeyFile,
      defaultKeyPath: path.join(repoRoot, "config", "manifest.minisign.pub"),
      hostPublicKeys: hostCfg?.selfUpdate?.publicKeys,
    });
    await verifyManifestSignature({ manifestPath: inPath, signaturePath, publicKeys });
    console.log("ok: signature verified");
  },
});

const manifestPromote = defineCommand({
  meta: {
    name: "promote",
    description: "Promote an existing release manifest to a different channel (no rebuild; new releaseId).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    in: { type: "string", description: "Input release manifest path." },
    channel: { type: "string", description: "Target release channel (staging|prod|...)." },
    releaseId: { type: "string", description: "Target monotonic issuance id (integer)." },
    issuedAt: { type: "string", description: "RFC3339/ISO8601 timestamp (default: now)." },
    out: { type: "string", description: "Output manifest path (default: deploy/<host>/<channel>/<releaseId>.json)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName } = ctx;

    const inRaw = String((args as any).in || "").trim();
    if (!inRaw) throw new Error("missing --in");
    const inPath = toPathFromCwd(cwd, inRaw);

    const src = parseReleaseManifestFile(inPath);
    if (src.host !== hostName) {
      throw new Error(`manifest host mismatch: ${src.host} vs ${hostName}`);
    }

    const channel = requireChannel(String(args.channel || ""));
    const releaseId = requireReleaseId(String((args as any).releaseId || ""));
    const issuedAt = String(args.issuedAt || "").trim() || new Date().toISOString();

    const outRaw = String(args.out || "").trim();
    const outPath = outRaw ? toPathFromCwd(cwd, outRaw) : path.join(cwd, "deploy", hostName, channel, `${String(releaseId)}.json`);

    if (fs.existsSync(outPath)) {
      throw new Error(`refusing to overwrite existing manifest: ${outPath}`);
    }

    const promoted = ReleaseManifestV1Schema.parse({
      ...src,
      channel,
      releaseId,
      issuedAt,
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, formatReleaseManifest(promoted), "utf8");
    console.log(`ok: wrote promoted release manifest ${outPath}`);
  },
});

export const releaseManifest = defineCommand({
  meta: {
    name: "manifest",
    description: "Release manifest build/sign/verify (Path 1 contract).",
  },
  subCommands: {
    build: manifestBuild,
    sign: manifestSign,
    verify: manifestVerify,
    promote: manifestPromote,
  },
});
