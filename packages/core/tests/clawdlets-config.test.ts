import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("clawdlets config schema", () => {
  it("assertSafeHostName rejects invalid names", async () => {
    const { assertSafeHostName } = await import("../src/lib/clawdlets-config");
    expect(() => assertSafeHostName("../pwn")).toThrow(/invalid host name/i);
  });

  it("assertSafeHostName accepts valid names", async () => {
    const { assertSafeHostName } = await import("../src/lib/clawdlets-config");
    expect(() => assertSafeHostName("clawdbot-fleet-host")).not.toThrow();
  });

  it("rejects unsafe host names (path traversal)", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "../pwn": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/invalid host name/i);
  });

  it("rejects duplicate bot ids", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren", "maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/duplicate bot id/i);
  });

  it("rejects missing botOrder when bots present", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: [], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/botOrder must be set/i);
  });

  it("rejects botOrder with unknown bot id", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren", "ghost"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/unknown bot id/i);
  });

  it("rejects botOrder missing bots", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {}, sonja: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/botOrder missing bots/i);
  });

  it("rejects invalid adminCidr values", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            provisioning: { adminCidr: "not-a-cidr", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/adminCidr/i);
  });

  it("rejects world-open adminCidr unless explicitly allowed", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            provisioning: { adminCidr: "0.0.0.0/0", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/adminCidrAllowWorldOpen/i);
  });

  it("accepts world-open adminCidr when explicitly allowed", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            provisioning: {
              adminCidr: "0.0.0.0/0",
              adminCidrAllowWorldOpen: true,
              sshPubkeyFile: "~/.ssh/id_ed25519.pub",
            },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).not.toThrow();
  });

  it("createDefaultClawdletsConfig trims and defaults", async () => {
    const { createDefaultClawdletsConfig } = await import("../src/lib/clawdlets-config");
    const cfg = createDefaultClawdletsConfig({ host: "   ", bots: [" maren ", "", "sonja"] });
    expect(Object.keys(cfg.hosts)).toEqual(["clawdbot-fleet-host"]);
    expect(cfg.defaultHost).toBe("clawdbot-fleet-host");
    expect(cfg.fleet.botOrder).toEqual(["maren", "sonja"]);
    expect(Object.keys(cfg.fleet.bots)).toEqual(["maren", "sonja"]);
    expect(cfg.fleet.envSecrets.ZAI_API_KEY).toBe("z_ai_api_key");
    expect(cfg.cattle.enabled).toBe(false);
    expect(cfg.cattle.hetzner.defaultTtl).toBe("2h");
    expect(cfg.hosts["clawdbot-fleet-host"].sshExposure?.mode).toBe("bootstrap");
    expect(cfg.hosts["clawdbot-fleet-host"].cache?.garnix?.private?.enable).toBe(false);
    expect(cfg.hosts["clawdbot-fleet-host"].provisioning?.adminCidrAllowWorldOpen).toBe(false);
  });

  it("does not share default object references across parses", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const baseHost = {
      enable: false,
      diskDevice: "/dev/sda",
      sshAuthorizedKeys: [],
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    const cfgA = ClawdletsConfigSchema.parse({
      schemaVersion: 7,
      fleet: { botOrder: ["maren"], bots: { maren: {} } },
      hosts: { "clawdbot-fleet-host": baseHost },
    }) as any;

    cfgA.fleet.envSecrets.NEW = "value";
    cfgA.fleet.bots.maren.profile.envSecrets.LOCAL = "secret";

    const cfgB = ClawdletsConfigSchema.parse({
      schemaVersion: 7,
      fleet: { botOrder: ["maren"], bots: { maren: {} } },
      hosts: { "clawdbot-fleet-host": baseHost },
    }) as any;

    expect(cfgB.fleet.envSecrets.NEW).toBeUndefined();
    expect(cfgB.fleet.bots.maren.profile.envSecrets.LOCAL).toBeUndefined();
  });

  it("rejects defaultHost not present in hosts", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        defaultHost: "missing-host",
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/defaultHost not found/i);
  });

  it("resolveHostName uses defaultHost and sole-host fallback", async () => {
    const { resolveHostName } = await import("../src/lib/clawdlets-config");
    const baseHost = {
      enable: false,
      diskDevice: "/dev/sda",
      sshAuthorizedKeys: [],
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    {
      const config = { schemaVersion: 7, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r).toEqual({ ok: true, host: "a", source: "defaultHost" });
    }

    {
      const config = { schemaVersion: 7, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: "a" });
      expect(r).toEqual({ ok: true, host: "a", source: "flag" });
    }

    {
      const config = { schemaVersion: 7, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: "b" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/unknown host/i);
    }

    {
      const config = { schemaVersion: 7, fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r).toEqual({ ok: true, host: "a", source: "soleHost" });
    }

    {
      const config = { schemaVersion: 7, fleet: {}, hosts: { a: baseHost, b: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r.ok).toBe(false);
    }
  });

  it("resolveHostName returns ok=false for invalid --host tokens", async () => {
    const { resolveHostName } = await import("../src/lib/clawdlets-config");
    const baseHost = {
      enable: false,
      diskDevice: "/dev/sda",
      sshAuthorizedKeys: [],
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    const config = { schemaVersion: 7, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
    const r = resolveHostName({ config, host: ";" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/invalid host name/i);
  });

  it("loadClawdletsConfig throws for missing config file", async () => {
    const { loadClawdletsConfig } = await import("../src/lib/clawdlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-missing-"));
    try {
      expect(() => loadClawdletsConfig({ repoRoot })).toThrow(/missing clawdlets config/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawdletsConfig throws for invalid JSON", async () => {
    const { loadClawdletsConfig } = await import("../src/lib/clawdlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-badjson-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      await writeFile(path.join(repoRoot, "fleet", "clawdlets.json"), "{", "utf8");
      expect(() => loadClawdletsConfig({ repoRoot })).toThrow(/invalid JSON/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawdletsConfig rejects legacy publicSsh key", async () => {
    const { loadClawdletsConfig } = await import("../src/lib/clawdlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-legacy-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            publicSsh: { enable: false },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawdlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawdletsConfig({ repoRoot })).toThrow(/legacy host config key publicSsh/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawdletsConfig rejects legacy opentofu key", async () => {
    const { loadClawdletsConfig } = await import("../src/lib/clawdlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-legacy-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 7,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: [],
            opentofu: {},
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawdlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawdletsConfig({ repoRoot })).toThrow(/legacy host config key opentofu/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid fleet.bots.<bot>.profile.envSecrets shapes", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: {
          botOrder: ["maren"],
          bots: { maren: { profile: { envSecrets: "nope" } } },
        },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/expected object/i);
  });

  it("rejects invalid fleet.bots.<bot>.profile.envSecrets entries", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        fleet: {
          botOrder: ["maren"],
          bots: {
            maren: {
              profile: {
                envSecrets: {
                  "bad-key": "openai_api_key",
                  OPENAI_API_KEY: "../pwn",
                },
              },
            },
          },
        },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid (env var name|secret name)/i);
  });

  it("rejects invalid cattle ttl strings", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        cattle: { enabled: true, hetzner: { image: "img-1", defaultTtl: "2 hours" } },
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid ttl/i);
  });

  it("rejects cattle enabled without image", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        cattle: { enabled: true, hetzner: { image: "" } },
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/cattle\.hetzner\.image must be set/i);
  });

  it("rejects invalid cattle labels", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 7,
        cattle: { enabled: false, hetzner: { labels: { "bad key": "x" } } },
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid label key/i);
  });

  it("getTailnetMode normalizes to none/tailscale", async () => {
    const { getTailnetMode } = await import("../src/lib/clawdlets-config");
    expect(getTailnetMode({ tailnet: { mode: "tailscale" } } as any)).toBe("tailscale");
    expect(getTailnetMode({ tailnet: { mode: "none" } } as any)).toBe("none");
    expect(getTailnetMode({ tailnet: { mode: "weird" } } as any)).toBe("none");
    expect(getTailnetMode(undefined)).toBe("none");
  });
});
