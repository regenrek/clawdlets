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
        schemaVersion: 2,
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
        schemaVersion: 2,
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
    expect(cfg.fleet.bots).toEqual(["maren", "sonja"]);
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
});
