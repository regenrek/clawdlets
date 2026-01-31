import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveManifestPublicKeys,
  resolveManifestSignaturePath,
  signFileWithMinisign,
  verifyManifestSignature,
} from "../src/lib/manifest-signature";

const runMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@clawdlets/core/lib/run", () => ({
  run: runMock,
}));

describe("manifest signature helpers", () => {
  beforeEach(() => {
    runMock.mockReset();
    runMock.mockResolvedValue(undefined);
  });
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
    expect(resolveManifestPublicKeys({ publicKeyFileArg: keyPath })).toEqual(["PUBKEY"]);
    expect(resolveManifestPublicKeys({ defaultKeyPath: keyPath })).toEqual(["PUBKEY"]);
    expect(resolveManifestPublicKeys({ hostPublicKeys: ["FROMCFG"] })).toEqual(["FROMCFG"]);
  });

  it("fails verification when minisign is missing", async () => {
    const err = Object.assign(new Error("spawn minisign ENOENT"), { code: "ENOENT" });
    runMock.mockRejectedValueOnce(err);
    await expect(
      verifyManifestSignature({ manifestPath: "m.json", signaturePath: "m.json.minisig", publicKeys: ["PUB"] }),
    ).rejects.toThrow(/minisign not found/);
  });

  it("fails verification on invalid signature", async () => {
    runMock.mockRejectedValueOnce(new Error("minisign exited with code 1"));
    await expect(
      verifyManifestSignature({ manifestPath: "m.json", signaturePath: "m.json.minisig", publicKeys: ["PUB"] }),
    ).rejects.toThrow(/manifest signature invalid/);
  });

  it("signs using a temp key file from env and cleans up", async () => {
    process.env["TEST_MINISIGN_KEY"] = "untrusted comment: key\nRANDOMKEY\n";

    const calls: any[] = [];
    runMock.mockImplementationOnce(async (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      const keyIndex = args.indexOf("-s");
      const keyPath = keyIndex >= 0 ? args[keyIndex + 1] : "";
      expect(keyPath).toMatch(/minisign\.key$/);
      expect(fs.existsSync(keyPath)).toBe(true);
      return undefined;
    });

    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-sign-"));
    const filePath = path.join(dir, "manifest.json");
    const sigPath = path.join(dir, "manifest.json.minisig");
    fs.writeFileSync(filePath, "{}\n", "utf8");

    await signFileWithMinisign({ filePath, signaturePath: sigPath, privateKeyEnv: "TEST_MINISIGN_KEY" });
    expect(calls.length).toBe(1);

    const keyIndex = calls[0]?.[1]?.indexOf("-s") ?? -1;
    const keyPath = keyIndex >= 0 ? calls[0][1][keyIndex + 1] : "";
    expect(keyPath).toBeTruthy();
    expect(fs.existsSync(keyPath)).toBe(false);
  });

  it("rejects signing when no key is provided", async () => {
    delete process.env["MISSING_MINISIGN_KEY"];
    await expect(
      signFileWithMinisign({ filePath: "m.json", signaturePath: "m.json.minisig", privateKeyEnv: "MISSING_MINISIGN_KEY" }),
    ).rejects.toThrow(/minisign private key missing/i);
  });
});
