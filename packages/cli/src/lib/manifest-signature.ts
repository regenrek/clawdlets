import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { run } from "@clawdlets/core/lib/run";

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

function readPublicKeysFromFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) throw new Error(`manifest public key file empty: ${filePath}`);
  const keys = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (keys.length === 0) throw new Error(`manifest public key file empty: ${filePath}`);
  return keys;
}

export function resolveManifestPublicKeys(params: {
  publicKeyArg?: string;
  publicKeyFileArg?: string;
  hostPublicKeys?: string[];
  defaultKeyPath?: string;
}): string[] {
  const direct = String(params.publicKeyArg || "").trim();
  if (direct) return [direct];
  const fileArg = String(params.publicKeyFileArg || "").trim();
  if (fileArg) {
    return readPublicKeysFromFile(fileArg);
  }
  const fallbackPath = String(params.defaultKeyPath || "").trim();
  if (fallbackPath && fs.existsSync(fallbackPath)) {
    return readPublicKeysFromFile(fallbackPath);
  }
  const fromHost = Array.isArray(params.hostPublicKeys) ? params.hostPublicKeys.map((k) => String(k).trim()).filter(Boolean) : [];
  if (fromHost.length > 0) return fromHost;
  throw new Error("manifest public key missing (set hosts.<host>.selfUpdate.publicKeys or --manifest-public-key)");
}

export async function verifyManifestSignature(params: {
  manifestPath: string;
  signaturePath: string;
  publicKeys: string[];
}): Promise<void> {
  let lastErr: unknown = null;
  const keys = Array.isArray(params.publicKeys) ? params.publicKeys.map((k) => String(k).trim()).filter(Boolean) : [];
  if (keys.length === 0) throw new Error("manifest public key missing (no keys provided)");

  for (const key of keys) {
    try {
      await run("minisign", ["-Vm", params.manifestPath, "-P", key, "-x", params.signaturePath], { redact: [] });
      return;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const msg = String(err?.message || e);
      if (err?.code === "ENOENT" || msg.includes("spawn minisign ENOENT")) {
        throw new Error(`minisign not found (${msg}). Install minisign and retry.`);
      }
      lastErr = e;
      continue;
    }
  }

  const msg = String((lastErr as any)?.message || lastErr || "unknown error");
  throw new Error(`manifest signature invalid (${msg}). See minisign output above.`);
}

export async function signFileWithMinisign(params: {
  filePath: string;
  signaturePath: string;
  privateKeyFile?: string;
  privateKeyEnv?: string;
}): Promise<void> {
  const filePath = String(params.filePath || "").trim();
  if (!filePath) throw new Error("missing filePath");

  const signaturePath = String(params.signaturePath || "").trim();
  if (!signaturePath) throw new Error("missing signaturePath");

  let tempDir = "";
  let keyPath = String(params.privateKeyFile || "").trim();

  if (!keyPath) {
    const envName = String(params.privateKeyEnv || "MINISIGN_PRIVATE_KEY").trim() || "MINISIGN_PRIVATE_KEY";
    const keyContent = String(process.env[envName] || "").trim();
    if (!keyContent) {
      throw new Error(`minisign private key missing (set ${envName} or pass --private-key-file)`);
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-minisign."));
    keyPath = path.join(tempDir, "minisign.key");
    fs.writeFileSync(keyPath, `${keyContent}\n`, { mode: 0o600 });
  }

  try {
    await run("minisign", ["-S", "-s", keyPath, "-m", filePath, "-x", signaturePath], { redact: [] });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const msg = String(err?.message || e);
    if (err?.code === "ENOENT" || msg.includes("spawn minisign ENOENT")) {
      throw new Error(`minisign not found (${msg}). Install minisign and retry.`);
    }
    throw new Error(`minisign sign failed (${msg}). See minisign output above.`);
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
