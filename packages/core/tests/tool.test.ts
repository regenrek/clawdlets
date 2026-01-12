import { describe, it, expect, vi, beforeEach } from "vitest";

const nixToolsState = {
  shellOutput: "",
  shellWithInputOutput: "",
};

vi.mock("../src/lib/nix-tools.js", () => ({
  nixShellCapture: vi.fn(async () => nixToolsState.shellOutput),
  nixShellCaptureWithInput: vi.fn(async () => nixToolsState.shellWithInputOutput),
}));

beforeEach(() => {
  nixToolsState.shellOutput = "";
  nixToolsState.shellWithInputOutput = "";
  vi.resetModules();
});

describe("tool helpers", () => {
  it("supports dryRun", async () => {
    const { ageKeygen } = await import("../src/lib/age-keygen");
    const { mkpasswdYescryptHash } = await import("../src/lib/mkpasswd");
    const { looksLikeSshKeyContents, normalizeSshPublicKey } = await import("../src/lib/ssh");

    const pair = await ageKeygen({ nixBin: "nix", dryRun: true });
    expect(pair.publicKey.startsWith("age1")).toBe(true);
    expect(pair.secretKey.startsWith("AGE-SECRET-KEY-")).toBe(true);

    expect(await mkpasswdYescryptHash("pw", { nixBin: "nix", dryRun: true })).toBe(
      "<admin_password_hash>",
    );

    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test";
    expect(normalizeSshPublicKey(key)).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa");
    expect(normalizeSshPublicKey("nope")).toBeNull();
    expect(looksLikeSshKeyContents(key)).toBe(true);
    expect(looksLikeSshKeyContents("/tmp/id_ed25519.pub")).toBe(false);
  });

  it("parses age-keygen output (non-dryRun)", async () => {
    nixToolsState.shellOutput = [
      "# created: 2026-01-10T00:00:00Z",
      "# public key: age1abc",
      "AGE-SECRET-KEY-ABCDEF",
      "",
    ].join("\n");
    const { ageKeygen } = await import("../src/lib/age-keygen");
    const pair = await ageKeygen({ nixBin: "nix", dryRun: false });
    expect(pair.publicKey).toBe("age1abc");
    expect(pair.secretKey).toBe("AGE-SECRET-KEY-ABCDEF");
  });

  it("extracts yescrypt hash (non-dryRun)", async () => {
    nixToolsState.shellWithInputOutput = ["hello", "$y$hash", "bye"].join("\n");
    const { mkpasswdYescryptHash } = await import("../src/lib/mkpasswd");
    expect(await mkpasswdYescryptHash("pw", { nixBin: "nix", dryRun: false })).toBe("$y$hash");

    nixToolsState.shellWithInputOutput = "no hash here";
    await expect(mkpasswdYescryptHash("pw", { nixBin: "nix", dryRun: false })).rejects.toThrow(
      /no yescrypt hash/,
    );
  });
});
