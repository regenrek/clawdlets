import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import { makeConfig, baseHost } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const loadDeployCredsMock = vi.fn();
const buildFleetSecretsPlanMock = vi.fn();
const sopsDecryptMock = vi.fn();

vi.mock("../src/lib/context.js", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("@clawdlets/core/lib/fleet-secrets", () => ({
  buildFleetSecretsPlan: buildFleetSecretsPlanMock,
}));

vi.mock("@clawdlets/core/lib/sops", () => ({
  sopsDecryptYamlFile: sopsDecryptMock,
}));

describe("secrets verify", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("verifies secrets and prints json", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-verify-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    const ageKeyPath = path.join(repoRoot, "keys", "op.agekey");
    loadDeployCredsMock.mockReturnValue({ values: { NIX_BIN: "nix", SOPS_AGE_KEY_FILE: ageKeyPath } });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
    });

    const secretsDir = path.join(layout.secretsHostsDir, "alpha");
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.mkdirSync(path.dirname(ageKeyPath), { recursive: true });
    fs.writeFileSync(ageKeyPath, "AGE-SECRET-KEY-1", "utf8");
    fs.writeFileSync(path.join(secretsDir, "discord_token_maren.yaml"), "encrypted", "utf8");
    fs.writeFileSync(path.join(secretsDir, "admin_password_hash.yaml"), "encrypted", "utf8");
    sopsDecryptMock.mockImplementation(async ({ filePath }: { filePath: string }) => {
      if (filePath.endsWith("admin_password_hash.yaml")) return "admin_password_hash: hash\n";
      return "discord_token_maren: token\n";
    });

    const { secretsVerify } = await import("../src/commands/secrets/verify.js");
    await secretsVerify.run({ args: { host: "alpha", json: true } } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("\"results\""));
    expect(process.exitCode).toBe(0);
  });
});
