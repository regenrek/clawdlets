import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sopsPathRegexForDirFiles, sopsPathRegexForPathSuffix } from "../src/lib/sops-config";

let mockFleetMain: any = null;
let mockFleetTemplate: any = null;
let mockWheelMain: any = null;
let mockWheelTemplate: any = null;
let templateRoot = "";

vi.mock("../src/lib/run.js", () => ({
  capture: vi.fn(async (_cmd: string, args: string[], opts?: any) => {
    if (args.includes("--version")) return "nix (mock) 2.0";
    if (args[0] === "eval" || args.includes("eval")) {
      const isTemplate = String(opts?.cwd || "") === templateRoot;
      const expr = String(args[args.length - 1] || "");
      if (expr.includes("adminHasWheel") || expr.includes("breakglassHasWheel")) {
        return JSON.stringify(isTemplate ? mockWheelTemplate : mockWheelMain);
      }
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
    templateRoot = path.join(repoRoot, "__template__");
    process.env.CLAWDLETS_TEMPLATE_DIR = templateRoot;
    await writeFile(path.join(repoRoot, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await mkdir(path.join(repoRoot, "fleet", "workspaces", "common"), { recursive: true });
    await mkdir(path.join(templateRoot, "docs"), { recursive: true });
    await mkdir(path.join(templateRoot, "fleet"), { recursive: true });
    await mkdir(path.join(templateRoot, "fleet", "workspaces", "common"), { recursive: true });
    await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
    await mkdir(path.join(repoRoot, ".clawdlets", "extra-files", "clawdbot-fleet-host", "var", "lib", "sops-nix"), { recursive: true });

    const bundledSkillsText = ["[", '  "github",', '  "brave-search",', '  "coding-agent"', "]", ""].join("\n");
    await writeFile(path.join(repoRoot, "fleet", "bundled-skills.json"), bundledSkillsText, "utf8");
    await writeFile(path.join(templateRoot, "fleet", "bundled-skills.json"), bundledSkillsText, "utf8");

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
      await writeFile(path.join(templateRoot, "fleet", "workspaces", "common", name), text, "utf8");
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

    await writeFile(path.join(templateRoot, "docs", "overview.md"), "# overview\n", "utf8");
    await writeFile(
      path.join(templateRoot, "docs", "docs.yaml"),
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
      schemaVersion: 11,
      defaultHost: "clawdbot-fleet-host",
      baseFlake: "",
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
        sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"],
        sshKnownHosts: [],
        botOrder: ["alpha", "beta"],
        bots: {
          alpha: {
            profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_alpha" } },
            clawdbot: { channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } } },
          },
          beta: {
            profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_beta" } },
            clawdbot: { channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } } },
          },
        },
        codex: { enable: false, bots: [] },
        backups: { restic: { enable: false, repository: "" } },
      },
      hosts: {
        "clawdbot-fleet-host": {
          enable: false,
          diskDevice: "/dev/disk/by-id/TEST",
          flakeHost: "",
          hetzner: { serverType: "cx43" },
          provisioning: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "id_ed25519.pub" },
          sshExposure: { mode: "tailnet" },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    };

    await writeFile(path.join(repoRoot, "fleet", "clawdlets.json"), JSON.stringify(clawdletsConfig, null, 2) + "\n", "utf8");
    await writeFile(path.join(templateRoot, "fleet", "clawdlets.json"), JSON.stringify(clawdletsConfig, null, 2) + "\n", "utf8");

    mockFleetMain = {
      bots: ["alpha", "beta"],
      botProfiles: {
        alpha: { skills: { allowBundled: [], entries: {} }, github: {} },
        beta: { skills: { allowBundled: [], entries: {} }, github: {} },
      },
    };
    mockFleetTemplate = structuredClone(mockFleetMain);

    mockWheelMain = { adminHasWheel: false, breakglassHasWheel: true };
    mockWheelTemplate = structuredClone(mockWheelMain);

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
  });

  afterAll(async () => {
    try {
      await rm(repoRoot, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv, CLAWDLETS_TEMPLATE_DIR: templateRoot };
    mockFleetMain = {
      bots: ["alpha", "beta"],
      botProfiles: {
        alpha: { skills: { allowBundled: [], entries: {} }, github: {} },
        beta: { skills: { allowBundled: [], entries: {} }, github: {} },
      },
    };
    mockFleetTemplate = structuredClone(mockFleetMain);
    mockWheelMain = { adminHasWheel: false, breakglassHasWheel: true };
    mockWheelTemplate = structuredClone(mockWheelMain);
    vi.clearAllMocks();
  });

  it("passes with a fully seeded repo", async () => {
    process.env.HCLOUD_TOKEN = "abc";
    delete process.env.SOPS_AGE_KEY_FILE;
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.filter((c) => c.status === "missing")).toEqual([]);
  });

  it("warns when clawdlets config fails to load", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");
    await writeFile(configPath, "{", "utf8");

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "server-deploy" });
    const check = checks.find((c) => c.label === "clawdlets config");
    expect(check?.status).toBe("warn");

    await writeFile(configPath, original, "utf8");
  });

  it("reports schema vs nix/upstream matches", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/clawdbot-schema.js", () => ({
      getPinnedClawdbotSchema: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        clawdbotRev: "rev1234567890abcd",
      }),
    }));
    vi.doMock("../src/lib/nix-clawdbot.js", () => ({
      getNixClawdbotRevFromFlakeLock: () => "pinrev",
      fetchNixClawdbotSourceInfo: async () => ({
        ok: true as const,
        info: { rev: "rev1234567890abcd" },
        sourceUrl: "https://example.com",
      }),
    }));

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    const pinned = checks.find((c) => c.label === "clawdbot schema vs nix-clawdbot");
    const upstream = checks.find((c) => c.label === "clawdbot schema vs upstream");
    expect(pinned?.status).toBe("ok");
    expect(upstream?.status).toBe("ok");
  });

  it("warns on schema mismatch and upstream fetch failure", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/clawdbot-schema.js", () => ({
      getPinnedClawdbotSchema: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        clawdbotRev: "rev1234567890abcd",
      }),
    }));
    vi.doMock("../src/lib/nix-clawdbot.js", () => ({
      getNixClawdbotRevFromFlakeLock: () => "pinrev",
      fetchNixClawdbotSourceInfo: async ({ ref }: { ref: string }) => {
        if (ref === "pinrev") {
          return { ok: true as const, info: { rev: "rev9999999999" }, sourceUrl: "https://example.com" };
        }
        return { ok: false as const, error: "rate limited", sourceUrl: "https://example.com" };
      },
    }));

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    const pinned = checks.find((c) => c.label === "clawdbot schema vs nix-clawdbot");
    const upstream = checks.find((c) => c.label === "clawdbot schema vs upstream");
    expect(pinned?.status).toBe("warn");
    expect(upstream?.status).toBe("warn");
    expect(upstream?.detail || "").toContain("unable to fetch");
  });

  it("warns when pinned nix-clawdbot fetch fails", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/clawdbot-schema.js", () => ({
      getPinnedClawdbotSchema: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        clawdbotRev: "rev1234567890abcd",
      }),
    }));
    vi.doMock("../src/lib/nix-clawdbot.js", () => ({
      getNixClawdbotRevFromFlakeLock: () => "pinrev",
      fetchNixClawdbotSourceInfo: async ({ ref }: { ref: string }) => {
        if (ref === "pinrev") {
          return { ok: false as const, error: "nope", sourceUrl: "https://example.com" };
        }
        return { ok: true as const, info: { rev: "rev1234567890abcd" }, sourceUrl: "https://example.com" };
      },
    }));

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    const pinned = checks.find((c) => c.label === "clawdbot schema vs nix-clawdbot");
    const upstream = checks.find((c) => c.label === "clawdbot schema vs upstream");
    expect(pinned?.status).toBe("warn");
    expect(pinned?.detail || "").toContain("nope");
    expect(upstream?.status).toBe("ok");
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
    mockWheelMain = { adminHasWheel: true, breakglassHasWheel: false };

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.some((c) => c.label === "admin wheel access" && c.status === "missing")).toBe(true);
    expect(checks.some((c) => c.label === "breakglass wheel access" && c.status === "missing")).toBe(true);
  });

  it("flags provisioning ssh pubkey file contents as invalid", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["clawdbot-fleet-host"].provisioning.sshPubkeyFile =
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test";
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(
      checks.some(
        (c) =>
          c.label === "provisioning ssh pubkey file" &&
          c.status === "missing" &&
          String(c.detail || "").includes("must be a path"),
      ),
    ).toBe(true);

    await writeFile(configPath, original, "utf8");
  });

  it("flags secrets in clawdbot.json5 and includes", async () => {
    const botDir = path.join(repoRoot, "fleet", "workspaces", "bots", "maren");
    const includeDir = path.join(botDir, "includes");
    await mkdir(includeDir, { recursive: true });
    await writeFile(path.join(includeDir, "extra.json5"), '{ "token": "SUPER_SECRET_1234567890" }\n', "utf8");
    await writeFile(path.join(botDir, "clawdbot.json5"), '{ "$include": "./includes/extra.json5" }\n', "utf8");

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    const check = checks.find((c) => c.label === "clawdbot config secrets");
    expect(check?.status).toBe("missing");

    await rm(botDir, { recursive: true, force: true });
  });

  it("flags secrets in fleet/clawdlets.json", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.fleet.bots.alpha = raw.fleet.bots.alpha || {};
    raw.fleet.bots.alpha.clawdbot = {
      channels: { discord: { enabled: true, token: "SUPER_SECRET_1234567890" } },
    };
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host", scope: "repo" });
    const check = checks.find((c) => c.label === "fleet config secrets");
    expect(check?.status).toBe("missing");

    await writeFile(configPath, original, "utf8");
  });

  it("fails when diskDevice is left as CHANGE_ME placeholder", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["clawdbot-fleet-host"].diskDevice = "/dev/sda-CHANGE_ME";
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    process.env.HCLOUD_TOKEN = "abc";
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.some((c) => c.label === "diskDevice" && c.status === "missing")).toBe(true);

    await writeFile(configPath, original, "utf8");
  });

  it("requires garnix_netrc when private Garnix cache enabled", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["clawdbot-fleet-host"].cache = {
      netrc: { enable: true, secretName: "garnix_netrc" },
    };
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    process.env.HCLOUD_TOKEN = "abc";
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "clawdbot-fleet-host" });
    expect(checks.some((c) => c.label === "secret: garnix_netrc" && c.status === "missing")).toBe(true);

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
