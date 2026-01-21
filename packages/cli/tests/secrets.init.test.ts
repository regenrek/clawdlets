import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHostEncryptedAgeKeyFile, getHostExtraFilesKeyPath, getLocalOperatorAgeKeyPath, getRepoLayout } from "@clawdlets/core/repo-layout";
import { makeConfig, baseHost } from "./fixtures.js";

const promptPasswordMock = vi.fn();
const promptTextMock = vi.fn();
const promptConfirmMock = vi.fn();

vi.mock("@clack/prompts", () => ({
  password: promptPasswordMock,
  text: promptTextMock,
  confirm: promptConfirmMock,
  isCancel: () => false,
}));

const loadHostContextMock = vi.fn();
const ageKeygenMock = vi.fn();
const agePublicKeyFromIdentityFileMock = vi.fn();
const mkpasswdMock = vi.fn();
const sopsEncryptMock = vi.fn();
const sopsDecryptMock = vi.fn();
const upsertSopsCreationRuleMock = vi.fn();
const buildFleetSecretsPlanMock = vi.fn();
const validateSecretsInitNonInteractiveMock = vi.fn();

vi.mock("@clawdlets/core/lib/age-keygen", () => ({
  ageKeygen: ageKeygenMock,
  agePublicKeyFromIdentityFile: agePublicKeyFromIdentityFileMock,
}));

vi.mock("@clawdlets/core/lib/mkpasswd", () => ({
  mkpasswdYescryptHash: mkpasswdMock,
}));

vi.mock("@clawdlets/core/lib/sops", () => ({
  sopsEncryptYamlToFile: sopsEncryptMock,
  sopsDecryptYamlFile: sopsDecryptMock,
}));

vi.mock("@clawdlets/core/lib/sops-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/sops-config")>(
    "@clawdlets/core/lib/sops-config",
  );
  return {
    ...actual,
    upsertSopsCreationRule: upsertSopsCreationRuleMock,
  };
});

vi.mock("@clawdlets/core/lib/fleet-secrets", () => ({
  buildFleetSecretsPlan: buildFleetSecretsPlanMock,
}));

vi.mock("@clawdlets/core/lib/secrets-init", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/secrets-init")>(
    "@clawdlets/core/lib/secrets-init",
  );
  return {
    ...actual,
    validateSecretsInitNonInteractive: validateSecretsInitNonInteractiveMock,
  };
});

vi.mock("@clawdlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

describe("secrets init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it("writes secrets and extra-files with from-json", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;

    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });

    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });

    ageKeygenMock.mockResolvedValue({
      secretKey: "AGE-SECRET-KEY-1",
      publicKey: "age1publickey",
      fileText: "AGE-SECRET-KEY-1",
    });
    mkpasswdMock.mockResolvedValue("hash");
    upsertSopsCreationRuleMock.mockReturnValue("sops");

    sopsEncryptMock.mockImplementation(async ({ plaintextYaml, outPath }: { plaintextYaml: string; outPath: string }) => {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, plaintextYaml, "utf8");
    });
    sopsDecryptMock.mockResolvedValue("secret: value\n");

    const secretsJson = {
      adminPasswordHash: "hash",
      discordTokens: { maren: "token" },
    };
    const jsonPath = path.join(repoRoot, ".clawdlets", "secrets.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(secretsJson), "utf8");

    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await secretsInit.run({ args: { host: "alpha", fromJson: jsonPath, yes: true } } as any);

    const localSecret = path.join(layout.secretsHostsDir, "alpha", "discord_token_maren.yaml");
    const extraSecret = path.join(layout.extraFilesDir, "alpha", "var", "lib", "clawdlets", "secrets", "hosts", "alpha", "discord_token_maren.yaml");
    expect(fs.existsSync(localSecret)).toBe(true);
    expect(fs.existsSync(extraSecret)).toBe(true);
  });

  it("fails when fleet.botOrder is empty", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: [], bots: {} },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await expect(secretsInit.run({ args: { host: "alpha" } } as any)).rejects.toThrow(/botOrder is empty/i);
  });

  it("fails when private garnix cache lacks netrc secret", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: {
        ...baseHost,
        tailnet: { mode: "none" },
      },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    hostCfg.cache = {
      garnix: {
        private: {
          enable: true,
          netrcSecret: "   ",
          netrcPath: "/etc/nix/netrc",
          narinfoCachePositiveTtl: 3600,
        },
      },
    } as any;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await expect(secretsInit.run({ args: { host: "alpha" } } as any)).rejects.toThrow(/netrcSecret must be set/i);
  });

  it("fails when discord secret config is missing", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: [],
      secretNamesRequired: [],
      discordSecretsByBot: {},
      missingSecretConfig: [{ kind: "discord", bot: "maren" }],
    });
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await expect(secretsInit.run({ args: { host: "alpha" } } as any)).rejects.toThrow(/missing discordTokenSecret/i);
  });

  it("writes template and exits when no from-json and not interactive", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await secretsInit.run({ args: { host: "alpha", dryRun: true } } as any);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/secrets template/i));
    errorSpy.mockRestore();
  });

  it("rejects missing --from-json file", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: [],
      secretNamesRequired: [],
      discordSecretsByBot: {},
      missingSecretConfig: [],
    });
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await expect(secretsInit.run({ args: { host: "alpha", fromJson: path.join(repoRoot, "missing.json") } } as any)).rejects.toThrow(
      /missing --from-json file/i,
    );
  });

  it("exits when default secrets json contains placeholders", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });
    fs.mkdirSync(layout.runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(layout.runtimeDir, "secrets.json"),
      JSON.stringify({
        adminPasswordHash: "<FILL_ME>",
        discordTokens: { maren: "<FILL_ME>" },
      }),
      "utf8",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await secretsInit.run({ args: { host: "alpha" } } as any);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/placeholders found/i));
    errorSpy.mockRestore();
  });

  it("rejects when required discord token is missing in from-json", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });
    ageKeygenMock.mockResolvedValue({
      secretKey: "AGE-SECRET-KEY-1",
      publicKey: "age1publickey",
      fileText: "AGE-SECRET-KEY-1",
    });
    upsertSopsCreationRuleMock.mockReturnValue("sops");
    const jsonPath = path.join(repoRoot, ".clawdlets", "secrets.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        adminPasswordHash: "hash",
        discordTokens: {},
        secrets: {},
      }),
      "utf8",
    );
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await expect(
      secretsInit.run({ args: { host: "alpha", fromJson: jsonPath, allowPlaceholders: false, dryRun: true } } as any),
    ).rejects.toThrow(/missing discord token/i);
  });

  it("rejects when discord token is provided via secrets map (double-entry)", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });
    ageKeygenMock.mockResolvedValue({
      secretKey: "AGE-SECRET-KEY-1",
      publicKey: "age1publickey",
      fileText: "AGE-SECRET-KEY-1",
    });
    upsertSopsCreationRuleMock.mockReturnValue("sops");
    const jsonPath = path.join(repoRoot, ".clawdlets", "secrets.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        adminPasswordHash: "hash",
        discordTokens: { maren: "token" },
        secrets: { discord_token_maren: "token" },
      }),
      "utf8",
    );
    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await expect(
      secretsInit.run({ args: { host: "alpha", fromJson: jsonPath, yes: true, dryRun: true } } as any),
    ).rejects.toThrow(/remove secrets\.discord_token_maren/i);
  });

  it("collects interactive secrets including netrc and discord token", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-"));
    const layout = getRepoLayout(repoRoot);
    const netrcPath = path.join(repoRoot, "garnix.netrc");
    fs.writeFileSync(netrcPath, "machine cache.garnix.io login token", "utf8");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: {
        ...baseHost,
        tailnet: { mode: "tailscale" },
        cache: { garnix: { private: { enable: true, netrcSecret: "garnix_netrc", netrcPath: "/etc/nix/netrc", narinfoCachePositiveTtl: 3600 } } },
      },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren", "api_key"],
      secretNamesRequired: ["discord_token_maren", "api_key"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });
    ageKeygenMock.mockResolvedValue({
      secretKey: "AGE-SECRET-KEY-1",
      publicKey: "age1publickey",
      fileText: "AGE-SECRET-KEY-1",
    });
    mkpasswdMock.mockResolvedValue("hash");
    upsertSopsCreationRuleMock.mockReturnValue("sops");
    sopsEncryptMock.mockImplementation(async ({ plaintextYaml, outPath }: { plaintextYaml: string; outPath: string }) => {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, plaintextYaml, "utf8");
    });
    promptPasswordMock
      .mockResolvedValueOnce("admin-pass")
      .mockResolvedValueOnce("ts-auth-key")
      .mockResolvedValueOnce("api-key-value")
      .mockResolvedValueOnce("discord-token");
    promptTextMock.mockResolvedValueOnce(netrcPath);
    promptConfirmMock.mockResolvedValueOnce(true);

    const stdoutTty = process.stdout.isTTY;
    const stdinTty = process.stdin.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await secretsInit.run({ args: { host: "alpha", interactive: true, yes: true } } as any);

    Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: stdinTty, configurable: true });

    const localSecret = path.join(layout.secretsHostsDir, "alpha", "discord_token_maren.yaml");
    expect(fs.existsSync(localSecret)).toBe(true);
  });

  it("rewrites stale operator .age.pub from private key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-init-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });

    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });

    agePublicKeyFromIdentityFileMock.mockResolvedValue("age1correct");
    ageKeygenMock.mockResolvedValue({
      secretKey: "AGE-SECRET-KEY-1",
      publicKey: "age1publickey",
      fileText: "AGE-SECRET-KEY-1",
    });
    mkpasswdMock.mockResolvedValue("hash");
    upsertSopsCreationRuleMock.mockReturnValue("sops");

    sopsEncryptMock.mockImplementation(async ({ plaintextYaml, outPath }: { plaintextYaml: string; outPath: string }) => {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, plaintextYaml, "utf8");
    });
    sopsDecryptMock.mockResolvedValue("secret: value\n");

    const operatorId = "me";
    const operatorKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId);
    const operatorPubPath = path.join(layout.localOperatorKeysDir, `${operatorId}.age.pub`);
    fs.mkdirSync(path.dirname(operatorKeyPath), { recursive: true });
    fs.writeFileSync(operatorKeyPath, "AGE-SECRET-KEY-ABCDEF\n", "utf8");
    fs.writeFileSync(operatorPubPath, "age1wrong\n", "utf8");

    const secretsJson = {
      adminPasswordHash: "hash",
      discordTokens: { maren: "token" },
    };
    const jsonPath = path.join(repoRoot, ".clawdlets", "secrets.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(secretsJson), "utf8");

    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await secretsInit.run({ args: { host: "alpha", operator: operatorId, fromJson: jsonPath, yes: true } } as any);

    expect(fs.readFileSync(operatorPubPath, "utf8")).toBe("age1correct\n");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/operator public key mismatch/i));
    errorSpy.mockRestore();
  });

  it("recovers host age key from extra-files when encrypted key is not decryptable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-secrets-init-"));
    const layout = getRepoLayout(repoRoot);
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "none" } },
      fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });

    buildFleetSecretsPlanMock.mockReturnValue({
      secretNamesAll: ["discord_token_maren"],
      secretNamesRequired: ["discord_token_maren"],
      discordSecretsByBot: { maren: "discord_token_maren" },
      missingSecretConfig: [],
    });

    agePublicKeyFromIdentityFileMock.mockImplementation(async (p: string) => (p.includes("extra-files") ? "age1host" : "age1operator"));
    ageKeygenMock.mockResolvedValue({
      secretKey: "AGE-SECRET-KEY-NEW",
      publicKey: "age1new",
      fileText: "AGE-SECRET-KEY-NEW",
    });
    mkpasswdMock.mockResolvedValue("hash");
    upsertSopsCreationRuleMock.mockReturnValue("sops");

    const hostKeyFile = getHostEncryptedAgeKeyFile(layout, "alpha");
    fs.mkdirSync(path.dirname(hostKeyFile), { recursive: true });
    fs.writeFileSync(hostKeyFile, "encrypted", "utf8");
    sopsDecryptMock.mockImplementation(async ({ filePath }: { filePath: string }) => {
      if (filePath === hostKeyFile) throw new Error("decrypt failed");
      return "secret: value\n";
    });

    sopsEncryptMock.mockImplementation(async ({ plaintextYaml, outPath }: { plaintextYaml: string; outPath: string }) => {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, plaintextYaml, "utf8");
    });

    const operatorId = "me";
    const operatorKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId);
    fs.mkdirSync(path.dirname(operatorKeyPath), { recursive: true });
    fs.writeFileSync(operatorKeyPath, "AGE-SECRET-KEY-OP", "utf8");

    const extraFilesKeyPath = getHostExtraFilesKeyPath(layout, "alpha");
    fs.mkdirSync(path.dirname(extraFilesKeyPath), { recursive: true });
    fs.writeFileSync(extraFilesKeyPath, "AGE-SECRET-KEY-HOST", "utf8");

    const secretsJson = {
      adminPasswordHash: "hash",
      discordTokens: { maren: "token" },
    };
    const jsonPath = path.join(repoRoot, ".clawdlets", "secrets.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(secretsJson), "utf8");

    const { secretsInit } = await import("../src/commands/secrets/init.js");
    await secretsInit.run({ args: { host: "alpha", operator: operatorId, fromJson: jsonPath, yes: true } } as any);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/recovered from/));
    expect(fs.existsSync(hostKeyFile)).toBe(true);
    errorSpy.mockRestore();
  });
});
