import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sopsPathRegexForDirFiles, sopsPathRegexForPathSuffix } from "../src/lib/sops-config";

let mockFleetMain: any = null;
let mockFleetTemplate: any = null;

vi.mock("../src/lib/run.js", () => ({
  capture: vi.fn(async (_cmd: string, args: string[]) => {
    if (args.includes("--version")) return "nix (mock) 2.0";
    if (args[0] === "eval" || args.includes("eval")) {
      const joined = args.join(" ");
      const isTemplate = joined.includes("packages/template/dist/template/infra/configs/fleet.nix");
      return JSON.stringify(isTemplate ? mockFleetTemplate : mockFleetMain);
    }
    return "";
  }),
  run: vi.fn(async () => {}),
  captureWithInput: vi.fn(async () => ""),
}));

vi.mock("../src/lib/git.js", () => ({
  tryGetOriginFlake: vi.fn(async () => null),
}));

vi.mock("../src/lib/github.js", () => ({
  tryParseGithubFlakeUri: vi.fn((flakeBase: string) => {
    const m = flakeBase.trim().match(/^github:([^/]+)\/([^/]+)(?:\/.*)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  }),
  checkGithubRepoVisibility: vi.fn(async () => ({ ok: true, status: "public" })),
}));

describe("doctor", () => {
  let repoRoot = "";
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-doctor-"));
    await writeFile(path.join(repoRoot, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await mkdir(path.join(repoRoot, "fleet", "workspaces", "common"), { recursive: true });
    await mkdir(path.join(repoRoot, "packages", "template", "dist", "template", "docs"), { recursive: true });
    await mkdir(path.join(repoRoot, "packages", "template", "dist", "template", "fleet"), { recursive: true });
    await mkdir(path.join(repoRoot, "packages", "template", "dist", "template", "fleet", "workspaces", "common"), { recursive: true });
    await mkdir(path.join(repoRoot, "packages", "template", "dist", "template", "infra", "configs"), { recursive: true });
    await mkdir(path.join(repoRoot, "packages", "template", "dist", "template", "infra", "nix", "hosts"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "opentofu"), { recursive: true });
    await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "nix", "hosts"), { recursive: true });
    await mkdir(path.join(repoRoot, ".clawdlets", "extra-files", "clawdbot-fleet-host", "var", "lib", "sops-nix"), { recursive: true });

    const bundledSkillsText = ["[", '  "github",', '  "brave-search",', '  "coding-agent"', "]", ""].join("\n");
    await writeFile(path.join(repoRoot, "fleet", "bundled-skills.json"), bundledSkillsText, "utf8");
    await writeFile(
      path.join(repoRoot, "packages", "template", "dist", "template", "fleet", "bundled-skills.json"),
      bundledSkillsText,
      "utf8",
    );

    const workspaceDocs = {
      "AGENTS.md": "# agents\n",
      "SOUL.md": "# soul\n",
      "IDENTITY.md": "# identity\n",
      "TOOLS.md": "# tools\n",
      "USER.md": "# user\n",
      "HEARTBEAT.md": "# heartbeat\n",
    };
    for (const [name, text] of Object.entries(workspaceDocs)) {
      await writeFile(path.join(repoRoot, "fleet", "workspaces", "common", name), text, "utf8");
      await writeFile(path.join(repoRoot, "packages", "template", "dist", "template", "fleet", "workspaces", "common", name), text, "utf8");
    }

    await writeFile(path.join(repoRoot, "docs", "overview.md"), "# overview\n", "utf8");
    await writeFile(
      path.join(repoRoot, "docs", "docs.yaml"),
      [
        "docs:",
        "  - path: docs/overview.md",
        "    when: seed",
        "    summary: seed",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(path.join(repoRoot, "packages", "template", "dist", "template", "docs", "overview.md"), "# overview\n", "utf8");
    await writeFile(
      path.join(repoRoot, "packages", "template", "dist", "template", "docs", "docs.yaml"),
      [
        "docs:",
        "  - path: docs/overview.md",
        "    when: seed",
        "    summary: seed",
        "",
      ].join("\n"),
      "utf8",
    );

    const sshPub = path.join(repoRoot, "id_ed25519.pub");
    await writeFile(sshPub, "ssh-ed25519 AAAATEST test\n", "utf8");

    const operatorKey = path.join(repoRoot, ".clawdlets", "keys", "operators", "tester.agekey");
    await mkdir(path.dirname(operatorKey), { recursive: true });
    await writeFile(operatorKey, "AGE-SECRET-KEY-TEST\n", "utf8");

    const clawdletsConfig = {
      schemaVersion: 4,
      defaultHost: "clawdbot-fleet-host",
      baseFlake: "",
      fleet: {
        guildId: "123",
        envSecrets: { ZAI_API_KEY: "z_ai_api_key", Z_AI_API_KEY: "z_ai_api_key" },
        bots: ["alpha", "beta"],
        botOverrides: {},
        routingOverrides: {
          alpha: { channels: ["bots"], requireMention: true },
          beta: { channels: ["bots"], requireMention: true },
        },
        codex: { enable: false, bots: [] },
        backups: { restic: { enable: false, repository: "" } },
      },
      hosts: {
        "clawdbot-fleet-host": {
          enable: false,
          diskDevice: "/dev/disk/by-id/TEST",
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"],
          flakeHost: "",
          hetzner: { serverType: "cx43" },
          opentofu: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "id_ed25519.pub" },
          publicSsh: { enable: false },
          provisioning: { enable: false },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    };

    await writeFile(path.join(repoRoot, "fleet", "clawdlets.json"), JSON.stringify(clawdletsConfig, null, 2) + "\n", "utf8");
    await writeFile(
      path.join(repoRoot, "packages", "template", "dist", "template", "fleet", "clawdlets.json"),
      JSON.stringify(clawdletsConfig, null, 2) + "\n",
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "configs", "fleet.nix"),
      [
        "{ lib }:",
        "let",
        "  cfg = builtins.fromJSON (builtins.readFile ../../fleet/clawdlets.json);",
        "  fleetCfg = cfg.fleet or { };",
        "in {",
        "  bots = fleetCfg.bots or [ \"alpha\" \"beta\" ];",
        "  botProfiles = {",
        "    alpha = { skills = { allowBundled = [ ]; entries = { }; }; github = { }; };",
        "    beta = { skills = { allowBundled = [ ]; entries = { }; }; github = { }; };",
        "  };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "packages", "template", "dist", "template", "infra", "configs", "fleet.nix"),
      [
        "{ lib }:",
        "let",
        "  cfg = builtins.fromJSON (builtins.readFile ../../fleet/clawdlets.json);",
        "  fleetCfg = cfg.fleet or { };",
        "in {",
        "  bots = fleetCfg.bots or [ \"alpha\" \"beta\" ];",
        "  botProfiles = {",
        "    alpha = { skills = { allowBundled = [ ]; entries = { }; }; github = { }; };",
        "    beta = { skills = { allowBundled = [ ]; entries = { }; }; github = { }; };",
        "  };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    mockFleetMain = {
      bots: ["alpha", "beta"],
      botProfiles: {
        alpha: { skills: { allowBundled: [], entries: {} }, github: {} },
        beta: { skills: { allowBundled: [], entries: {} }, github: {} },
      },
    };
    mockFleetTemplate = structuredClone(mockFleetMain);

    await mkdir(path.join(repoRoot, "secrets", "hosts", "clawdbot-fleet-host"), { recursive: true });
    await mkdir(path.join(repoRoot, "secrets", "keys", "hosts"), { recursive: true });

    await writeFile(
      path.join(repoRoot, "secrets", ".sops.yaml"),
      [
        "creation_rules:",
        `  - path_regex: ${sopsPathRegexForDirFiles("hosts/clawdbot-fleet-host", "yaml")}`,
        "    key_groups:",
        "      - age:",
        "          - age1a",
        "          - age1b",
        `  - path_regex: ${sopsPathRegexForPathSuffix("keys/hosts/clawdbot-fleet-host.agekey.yaml")}`,
        "    key_groups:",
        "      - age:",
        "          - age1a",
        "          - age1b",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "secrets", "keys", "hosts", "clawdbot-fleet-host.agekey.yaml"),
      "age_public_key: age1a\nage_secret_key: AGE-SECRET-KEY-TEST\nsops: {}\n",
      "utf8",
    );

    const secretsDir = path.join(repoRoot, "secrets", "hosts", "clawdbot-fleet-host");
    await writeFile(path.join(secretsDir, "admin_password_hash.yaml"), "admin_password_hash: y\nsops: {}\n", "utf8");
    await writeFile(path.join(secretsDir, "discord_token_alpha.yaml"), "discord_token_alpha: z\nsops: {}\n", "utf8");
    await writeFile(path.join(secretsDir, "discord_token_beta.yaml"), "discord_token_beta: z2\nsops: {}\n", "utf8");
    await writeFile(path.join(secretsDir, "z_ai_api_key.yaml"), "z_ai_api_key: k\nsops: {}\n", "utf8");

    await writeFile(
      path.join(repoRoot, ".clawdlets", "extra-files", "clawdbot-fleet-host", "var", "lib", "sops-nix", "key.txt"),
      "AGE-SECRET-KEY-TEST\n",
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "nix", "hosts", "clawdlets-host.nix"),
      [
        "users.users.admin = {",
        '  openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAATEST test" ];',
        "};",
        "users.users.breakglass = { extraGroups = [ \"wheel\" ]; };",
        "clawdlets.publicSsh.enable = false;",
        "clawdlets.provisioning.enable = false;",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "packages", "template", "dist", "template", "infra", "nix", "hosts", "clawdlets-host.nix"),
      [
        "{ config, lib, ... }:",
        "let",
        "  cfg = builtins.fromJSON (builtins.readFile ../../configs/clawdlets.json);",
        "  hostCfg = (cfg.hosts.${config.clawdlets.hostName} or { });",
        "in {",
        "  _module.args.hostCfg = hostCfg;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterAll(async () => {
    try {
      await rm(repoRoot, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    mockFleetMain = {
      bots: ["alpha", "beta"],
      botProfiles: {
        alpha: { skills: { allowBundled: [], entries: {} }, github: {} },
        beta: { skills: { allowBundled: [], entries: {} }, github: {} },
      },
    };
    mockFleetTemplate = structuredClone(mockFleetMain);
    vi.clearAllMocks();
  });

  it("passes with a fully seeded repo", async () => {
    process.env.HCLOUD_TOKEN = "abc";
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.filter((c) => c.status === "missing")).toEqual([]);
  });

  it("warns when clawdlets config fails to load", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");
    await writeFile(configPath, "{", "utf8");

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "deploy" });
    const check = checks.find((c) => c.label === "clawdlets config");
    expect(check?.status).toBe("warn");

    await writeFile(configPath, original, "utf8");
  });

  it("requires discord routing config (guildId + channels)", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.fleet.guildId = "";
    raw.fleet.routingOverrides = {};
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    process.env.HCLOUD_TOKEN = "abc";
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "deploy" });
    const check = checks.find((c) => c.label === "discord routing");
    expect(check?.status).toBe("missing");

    await writeFile(configPath, original, "utf8");
  });

  it("rejects skills.allowBundled = null in fleet configs", async () => {
    mockFleetMain.botProfiles.alpha.skills.allowBundled = null;
    mockFleetTemplate.botProfiles.alpha.skills.allowBundled = null;

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.some((c) => c.label === "fleet policy" && c.status === "missing")).toBe(true);
    expect(checks.some((c) => c.label === "template fleet policy" && c.status === "missing")).toBe(true);
  });

  it("rejects unknown bundled skills", async () => {
    mockFleetMain.botProfiles.alpha.skills.allowBundled = ["unknown-skill"];

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    expect(checks.some((c) => c.label === "fleet policy" && c.status === "missing")).toBe(true);
  });

  it("requires GitHub app auth config when bundled github enabled", async () => {
    mockFleetMain.botProfiles.alpha.skills.allowBundled = ["github"];
    mockFleetMain.botProfiles.alpha.github = {};

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    expect(checks.some((c) => c.label === "fleet policy" && c.status === "missing")).toBe(true);
  });

  it("requires breakglass in wheel and forbids admin in wheel", async () => {
    const hostPath = path.join(repoRoot, "infra", "nix", "hosts", "clawdlets-host.nix");
    const originalHost = await readFile(hostPath, "utf8");

    await writeFile(
      hostPath,
      [
        "users.users.admin = {",
        "  extraGroups = [ \"wheel\" ];",
        "};",
        "clawdlets.publicSsh.enable = false;",
        "clawdlets.provisioning.enable = false;",
        "",
      ].join("\n"),
      "utf8",
    );

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.some((c) => c.label === "admin wheel access" && c.status === "missing")).toBe(true);
    expect(checks.some((c) => c.label === "breakglass wheel access" && c.status === "missing")).toBe(true);

    await writeFile(hostPath, originalHost, "utf8");
  });

	  it("flags opentofu ssh pubkey file contents as invalid", async () => {
	    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
	    const original = await readFile(configPath, "utf8");

	    const raw = JSON.parse(original) as any;
	    raw.hosts["clawdbot-fleet-host"].opentofu.sshPubkeyFile =
	      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test";
	    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
	    expect(
	      checks.some(
	        (c) =>
	          c.label === "opentofu ssh pubkey file" &&
	          c.status === "missing" &&
	          String(c.detail || "").includes("must be a path"),
	      ),
	    ).toBe(true);

    await writeFile(configPath, original, "utf8");
  });

  it("requires GITHUB_TOKEN when repo is private", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/private-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "private-or-missing" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("missing");
  });

  it("accepts GITHUB_TOKEN when repo is public", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/public-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "public" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("ok");
  });

  it("warns when GitHub API is rate-limited", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "rate-limited" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when token set but GitHub check fails", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: false, status: "network", detail: "boom" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when API is rate-limited without token", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "rate-limited" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when API check fails without token", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: false, status: "network", detail: "boom" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("skips GitHub token checks when requested", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/private-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "private-or-missing" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", skipGithubTokenCheck: true });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("ok");
    expect(String(check?.detail || "")).toContain("skipped");
    expect(vi.mocked(github.checkGithubRepoVisibility)).not.toHaveBeenCalled();
  });
});
