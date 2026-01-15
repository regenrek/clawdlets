import fs from "node:fs";
import path from "node:path";
import { run } from "@clawdbot/clawdlets-core/lib/run";

export function resolveManifestSignaturePath(params: {
  cwd: string;
  manifestPath: string;
  signaturePathArg?: string;
}): string {
  const sigArg = String(params.signaturePathArg || "").trim();
  if (sigArg) {
    return path.isAbsolute(sigArg) ? sigArg : path.resolve(params.cwd, sigArg);
  }
  const fallback = `${params.manifestPath}.minisig`;
  if (fs.existsSync(fallback)) return fallback;
  throw new Error("manifest signature missing (provide --manifest-signature or <manifest>.minisig)");
}

export function resolveManifestPublicKey(params: {
  publicKeyArg?: string;
  publicKeyFileArg?: string;
  hostPublicKey?: string;
  defaultKeyPath?: string;
}): string {
  const direct = String(params.publicKeyArg || "").trim();
  if (direct) return direct;
  const fileArg = String(params.publicKeyFileArg || "").trim();
  if (fileArg) {
    const content = fs.readFileSync(fileArg, "utf8").trim();
    if (!content) throw new Error(`manifest public key file empty: ${fileArg}`);
    return content;
  }
  const fallbackPath = String(params.defaultKeyPath || "").trim();
  if (fallbackPath && fs.existsSync(fallbackPath)) {
    const content = fs.readFileSync(fallbackPath, "utf8").trim();
    if (!content) throw new Error(`manifest public key file empty: ${fallbackPath}`);
    return content;
  }
  const fromHost = String(params.hostPublicKey || "").trim();
  if (fromHost) return fromHost;
  throw new Error("manifest public key missing (set hosts.<host>.selfUpdate.publicKey or --manifest-public-key)");
}

export async function verifyManifestSignature(params: {
  manifestPath: string;
  signaturePath: string;
  publicKey: string;
}): Promise<void> {
  try {
    await run("minisign", ["-Vm", params.manifestPath, "-P", params.publicKey, "-x", params.signaturePath], {
      redact: [],
    });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg.includes("ENOENT") || msg.includes("minisign")) {
      throw new Error(`minisign verification failed (${msg}). Install minisign and retry.`);
    }
    throw e;
  }
}
