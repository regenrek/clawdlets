import fs from "node:fs";

export type DeployManifest = {
  rev: string;
  host: string;
  toplevel: string;
  secretsDigest?: string;
};

const REV_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export function requireRev(value: string): string {
  const v = value.trim();
  if (!REV_RE.test(v)) throw new Error(`invalid rev (expected 40-char sha): ${v || "<empty>"}`);
  return v;
}

export function requireToplevel(value: string): string {
  const v = value.trim();
  if (!v) throw new Error("missing toplevel store path");
  if (/\s/.test(v)) throw new Error(`invalid toplevel (contains whitespace): ${v}`);
  if (!v.startsWith("/nix/store/")) throw new Error(`invalid toplevel (expected /nix/store/...): ${v}`);
  return v;
}

export function parseDeployManifest(manifestPath: string): DeployManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid deploy manifest JSON: ${manifestPath} (${String((e as Error)?.message || e)})`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`invalid deploy manifest: ${manifestPath}`);
  const rev = requireRev(String((parsed as any).rev ?? ""));
  const host = String((parsed as any).host ?? "").trim();
  if (!host) throw new Error(`invalid deploy manifest host: ${manifestPath}`);
  const toplevel = requireToplevel(String((parsed as any).toplevel ?? ""));
  const secretsDigestRaw = String((parsed as any).secretsDigest ?? "").trim();
  const secretsDigest = secretsDigestRaw ? secretsDigestRaw : undefined;
  if (secretsDigest && !DIGEST_RE.test(secretsDigest)) {
    throw new Error(`invalid deploy manifest secretsDigest (expected sha256 hex): ${manifestPath}`);
  }
  return { rev, host, toplevel, secretsDigest };
}

export function formatDeployManifest(manifest: DeployManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
