import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

function baseConfig(host: string) {
  return {
    schemaVersion: 11,
    defaultHost: host,
    baseFlake: "",
    fleet: {
      secretEnv: {},
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      botOrder: ["agent"],
      bots: {
        agent: {
          profile: { secretEnv: {}, secretFiles: {} },
          clawdbot: {
            channels: {
              whatsapp: { enabled: true, dmPolicy: "open", allowFrom: ["*"] },
            },
          },
          clf: {},
        },
      },
      codex: { enable: false, bots: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    cattle: {
      enabled: false,
      hetzner: {
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawdlets" },
      },
      defaults: { autoShutdown: true, callbackUrl: "" },
    },
    hosts: {
      [host]: {
        enable: false,
        diskDevice: "/dev/sda",
        flakeHost: "",
        hetzner: { serverType: "cx22" },
        provisioning: {
          adminCidr: "",
          adminCidrAllowWorldOpen: false,
          sshPubkeyFile: "~/.ssh/id_ed25519.pub",
        },
        cache: {
          substituters: ["https://cache.nixos.org", "https://cache.garnix.io"],
          trustedPublicKeys: [
            "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
            "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
          ],
          netrc: { enable: false, secretName: "garnix_netrc", path: "/etc/nix/netrc", narinfoCachePositiveTtl: 3600 },
        },
        operator: { deploy: { enable: false } },
        sshExposure: { mode: "bootstrap" },
        tailnet: { mode: "none" },
        selfUpdate: {
          enable: false,
          interval: "30min",
          baseUrl: "",
          channel: "prod",
          publicKeys: [],
          allowUnsigned: false,
          allowRollback: false,
          healthCheckUnit: "",
        },
      },
    },
  };
}

describe("clawdbot harden command", () => {
  const originalCwd = process.cwd();
  let dir = "";
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    dir = await mkdtemp(path.join(tmpdir(), "clawdlets-harden-"));
    await writeFile(path.join(dir, "flake.nix"), "# test\n", "utf8");
    await mkdir(path.join(dir, "scripts"));
    await mkdir(path.join(dir, "fleet"));
    await writeFile(
      path.join(dir, "fleet", "clawdlets.json"),
      `${JSON.stringify(baseConfig("clawdbot-fleet-host"), null, 2)}\n`,
      "utf8",
    );
    process.chdir(dir);
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.chdir(originalCwd);
  });

  it("prints a plan when --write is not set", async () => {
    const { clawdbotHarden } = await import("../src/commands/clawdbot/harden.js");
    await clawdbotHarden.run({ args: {} } as any);
    const out = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(out).toMatch(/planned: update fleet\/clawdlets\.json/);
    expect(out).toMatch(/fleet\.bots\.agent\.clawdbot\.logging\.redactSensitive/);
    expect(out).toMatch(/fleet\.bots\.agent\.clawdbot\.session\.dmScope/);
    expect(out).toMatch(/fleet\.bots\.agent\.clawdbot\.channels\.whatsapp\.dmPolicy/);
    expect(out).toMatch(/fleet\.bots\.agent\.clawdbot\.channels\.whatsapp\.groupPolicy/);
  });

  it("writes changes when --write is set", async () => {
    const { clawdbotHarden } = await import("../src/commands/clawdbot/harden.js");
    await clawdbotHarden.run({ args: { write: true } } as any);
    const raw = await readFile(path.join(dir, "fleet", "clawdlets.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.fleet.bots.agent.clawdbot.logging.redactSensitive).toBe("tools");
    expect(parsed.fleet.bots.agent.clawdbot.session.dmScope).toBe("per-channel-peer");
    expect(parsed.fleet.bots.agent.clawdbot.channels.whatsapp.dmPolicy).toBe("pairing");
    expect(parsed.fleet.bots.agent.clawdbot.channels.whatsapp.groupPolicy).toBe("allowlist");
  });
});
