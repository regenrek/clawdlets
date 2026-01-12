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
        schemaVersion: 4,
        fleet: { bots: ["maren"] },
        hosts: {
          "../pwn": {
            enable: false,
            diskDevice: "/dev/disk/by-id/CHANGE_ME",
            sshAuthorizedKeys: [],
            publicSsh: { enable: false },
            provisioning: { enable: false },
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
        schemaVersion: 4,
        fleet: { bots: ["maren", "maren"] },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/disk/by-id/CHANGE_ME",
            sshAuthorizedKeys: [],
            publicSsh: { enable: false },
            provisioning: { enable: false },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/duplicate bot id/i);
  });

  it("createDefaultClawdletsConfig trims and defaults", async () => {
    const { createDefaultClawdletsConfig } = await import("../src/lib/clawdlets-config");
    const cfg = createDefaultClawdletsConfig({ host: "   ", bots: [" maren ", "", "sonja"] });
    expect(Object.keys(cfg.hosts)).toEqual(["clawdbot-fleet-host"]);
    expect(cfg.defaultHost).toBe("clawdbot-fleet-host");
    expect(cfg.fleet.bots).toEqual(["maren", "sonja"]);
    expect(cfg.fleet.envSecrets.ZAI_API_KEY).toBe("z_ai_api_key");
  });

  it("rejects defaultHost not present in hosts", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 4,
        defaultHost: "missing-host",
        fleet: { bots: ["maren"] },
        hosts: {
          "clawdbot-fleet-host": {
            enable: false,
            diskDevice: "/dev/disk/by-id/CHANGE_ME",
            sshAuthorizedKeys: [],
            publicSsh: { enable: false },
            provisioning: { enable: false },
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
      diskDevice: "/dev/disk/by-id/CHANGE_ME",
      sshAuthorizedKeys: [],
      publicSsh: { enable: false },
      provisioning: { enable: false },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    {
      const config = { schemaVersion: 4, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r).toEqual({ ok: true, host: "a", source: "defaultHost" });
    }

    {
      const config = { schemaVersion: 4, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: "a" });
      expect(r).toEqual({ ok: true, host: "a", source: "flag" });
    }

    {
      const config = { schemaVersion: 4, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: "b" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/unknown host/i);
    }

    {
      const config = { schemaVersion: 4, fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r).toEqual({ ok: true, host: "a", source: "soleHost" });
    }

    {
      const config = { schemaVersion: 4, fleet: {}, hosts: { a: baseHost, b: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r.ok).toBe(false);
    }
  });

  it("resolveHostName returns ok=false for invalid --host tokens", async () => {
    const { resolveHostName } = await import("../src/lib/clawdlets-config");
    const baseHost = {
      enable: false,
      diskDevice: "/dev/disk/by-id/CHANGE_ME",
      sshAuthorizedKeys: [],
      publicSsh: { enable: false },
      provisioning: { enable: false },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    const config = { schemaVersion: 4, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
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
      await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
      await writeFile(path.join(repoRoot, "infra", "configs", "clawdlets.json"), "{", "utf8");
      expect(() => loadClawdletsConfig({ repoRoot })).toThrow(/invalid JSON/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid botOverrides.<bot>.envSecrets shapes", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 4,
        fleet: {
          bots: ["maren"],
          botOverrides: {
            maren: {
              envSecrets: "nope",
            },
          },
        },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/envSecrets must be an object/i);
  });

  it("rejects invalid botOverrides.<bot>.envSecrets entries", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 4,
        fleet: {
          bots: ["maren"],
          botOverrides: {
            maren: {
              envSecrets: {
                "bad-key": "openai_api_key",
                OPENAI_API_KEY: "../pwn",
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
});
