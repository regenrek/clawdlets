import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const nixToolsState: {
  lastShellArgs: string[] | null;
  lastShellInput: string | null;
} = {
  lastShellArgs: null,
  lastShellInput: null,
};

const runState: {
  lastArgs: string[] | null;
} = {
  lastArgs: null,
};

let encryptedOutput = "<encrypted>";

vi.mock("../src/lib/nix-tools.js", () => ({
  nixShellCapture: vi.fn(async (_pkg: string, _cmd: string, args: string[]) => {
    nixToolsState.lastShellArgs = args;
    return "<decrypted>";
  }),
  nixShellCaptureWithInput: vi.fn(
    async (_pkg: string, _cmd: string, args: string[], input: string) => {
      nixToolsState.lastShellArgs = args;
      nixToolsState.lastShellInput = input;
      return encryptedOutput;
    },
  ),
}));

vi.mock("../src/lib/run.js", () => ({
  run: vi.fn(async (_cmd: string, args: string[]) => {
    runState.lastArgs = args;
  }),
}));

beforeEach(() => {
  nixToolsState.lastShellArgs = null;
  nixToolsState.lastShellInput = null;
  runState.lastArgs = null;
  encryptedOutput = "<encrypted>";
  vi.resetModules();
});

describe("sops args", () => {
  it("decrypt uses the expected sops args", async () => {
    const { sopsDecryptYamlFile } = await import("../src/lib/sops");
    await sopsDecryptYamlFile({
      filePath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      filenameOverride: "clawdbot-fleet-host.yaml",
      ageKeyFile: "/tmp/operator.agekey",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(nixToolsState.lastShellArgs).not.toBeNull();
    const args = nixToolsState.lastShellArgs!;
    expect(args[0]).toBe("decrypt");
    expect(args).toContain("--filename-override");
    expect(args).toContain("clawdbot-fleet-host.yaml");
    expect(args[args.length - 1]).toBe("/tmp/hosts/clawdbot-fleet-host.yaml");
  });

  it("decrypt includes --config when set", async () => {
    const { sopsDecryptYamlFile } = await import("../src/lib/sops");
    await sopsDecryptYamlFile({
      filePath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      configPath: "/tmp/.sops.yaml",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(nixToolsState.lastShellArgs).not.toBeNull();
    const args = nixToolsState.lastShellArgs!;
    expect(args[0]).toBe("--config");
    expect(args[1]).toBe("/tmp/.sops.yaml");
    expect(args[2]).toBe("decrypt");
  });

  it("decrypt omits filename-override when not set", async () => {
    const { sopsDecryptYamlFile } = await import("../src/lib/sops");
    await sopsDecryptYamlFile({
      filePath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(nixToolsState.lastShellArgs).not.toBeNull();
    const args = nixToolsState.lastShellArgs!;
    expect(args).not.toContain("--filename-override");
    expect(args[args.length - 1]).toBe("/tmp/hosts/clawdbot-fleet-host.yaml");
  });

  it("encrypt defaults filename-override to outPath", async () => {
    const { sopsEncryptYamlToFile } = await import("../src/lib/sops");
    await sopsEncryptYamlToFile({
      plaintextYaml: "hello: world\n",
      outPath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(runState.lastArgs).not.toBeNull();
    const args = runState.lastArgs!;
    const idxEncrypt = args.indexOf("encrypt");
    expect(idxEncrypt).toBeGreaterThanOrEqual(0);
    const idxOverride = args.indexOf("--filename-override");
    expect(idxOverride).toBeGreaterThanOrEqual(0);
    expect(args[idxOverride + 1]).toBe("/tmp/hosts/clawdbot-fleet-host.yaml");
  });

  it("encrypt includes --config when set", async () => {
    const { sopsEncryptYamlToFile } = await import("../src/lib/sops");
    await sopsEncryptYamlToFile({
      plaintextYaml: "hello: world\n",
      outPath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      configPath: "/tmp/.sops.yaml",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(runState.lastArgs).not.toBeNull();
    const args = runState.lastArgs!;
    const idxConfig = args.indexOf("--config");
    expect(idxConfig).toBeGreaterThanOrEqual(0);
    expect(args[idxConfig + 1]).toBe("/tmp/.sops.yaml");
  });

  it("encrypt passes plaintext via stdin", async () => {
    const { sopsEncryptYamlToFile } = await import("../src/lib/sops");
    const dir = await mkdtemp(path.join(tmpdir(), "clawdlets-sops-"));
    const outPath = path.join(dir, "secrets.enc.yaml");
    try {
      await sopsEncryptYamlToFile({
        plaintextYaml: "hello: world",
        outPath,
        nix: { nixBin: "nix" },
      });

      expect(nixToolsState.lastShellArgs).not.toBeNull();
      expect(nixToolsState.lastShellArgs).toContain("/dev/stdin");
      expect(nixToolsState.lastShellInput).toBe("hello: world\n");
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("encrypt writes output with 0600 perms", async () => {
    const { sopsEncryptYamlToFile } = await import("../src/lib/sops");
    const dir = await mkdtemp(path.join(tmpdir(), "clawdlets-sops-"));
    const outPath = path.join(dir, "secrets.enc.yaml");
    try {
      encryptedOutput = "<encrypted>\n";
      await sopsEncryptYamlToFile({
        plaintextYaml: "hello: world",
        outPath,
        nix: { nixBin: "nix" },
      });

      const contents = await readFile(outPath, "utf8");
      expect(contents).toBe("<encrypted>\n");
      const mode = (await stat(outPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
    }
  });
});
