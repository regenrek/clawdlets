import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  resolveManifestPublicKey,
  resolveManifestSignaturePath,
  verifyManifestSignature,
} from "../src/lib/manifest-signature";

const runMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@clawdbot/clawdlets-core/lib/run", () => ({
  run: runMock,
}));

describe("manifest signature helpers", () => {
  it("defaults signature path to <manifest>.minisig", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-manifest-"));
    const manifest = path.join(dir, "deploy.json");
    const sig = `${manifest}.minisig`;
    fs.writeFileSync(sig, "sig", "utf8");
    expect(resolveManifestSignaturePath({ cwd: dir, manifestPath: manifest })).toBe(sig);
  });

  it("rejects missing signature", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-manifest-"));
    const manifest = path.join(dir, "deploy.json");
    expect(() => resolveManifestSignaturePath({ cwd: dir, manifestPath: manifest })).toThrow(/signature missing/);
  });

  it("resolves public key from file or config", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-key-"));
    const keyPath = path.join(dir, "minisign.pub");
    fs.writeFileSync(keyPath, "PUBKEY", "utf8");
    expect(resolveManifestPublicKey({ publicKeyFileArg: keyPath })).toBe("PUBKEY");
    expect(resolveManifestPublicKey({ defaultKeyPath: keyPath })).toBe("PUBKEY");
    expect(resolveManifestPublicKey({ hostPublicKey: "FROMCFG" })).toBe("FROMCFG");
  });

  it("fails verification when minisign fails", async () => {
    runMock.mockRejectedValueOnce(new Error("minisign failed"));
    await expect(
      verifyManifestSignature({ manifestPath: "m.json", signaturePath: "m.json.minisig", publicKey: "PUB" }),
    ).rejects.toThrow(/minisign verification failed/);
  });
});
