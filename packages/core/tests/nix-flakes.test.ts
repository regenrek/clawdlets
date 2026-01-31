import { describe, it, expect } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFlakesEnv } from "../src/lib/nix-flakes";

describe("nix-flakes", () => {
  it("adds NIX_CONFIG when missing", () => {
    const out = withFlakesEnv({ PATH: "/bin", HOME: tmpdir(), NIX_CONFIG: "" });
    expect(String(out.NIX_CONFIG || "")).toContain("experimental-features");
    expect(String(out.NIX_CONFIG || "")).toContain("nix-command");
    expect(String(out.NIX_CONFIG || "")).toContain("flakes");
  });

  it("keeps existing NIX_CONFIG if it already enables flakes", () => {
    const env = { HOME: tmpdir(), NIX_CONFIG: "experimental-features = nix-command flakes\nfoo = bar" };
    const out = withFlakesEnv(env);
    expect(String(out.NIX_CONFIG || "")).toContain(env.NIX_CONFIG);
  });

  it("appends flakes enablement when NIX_CONFIG is present but incomplete", () => {
    const env = { HOME: tmpdir(), NIX_CONFIG: "sandbox = false" };
    const out = withFlakesEnv(env);
    expect(String(out.NIX_CONFIG || "")).toContain("sandbox = false");
    expect(String(out.NIX_CONFIG || "")).toContain("experimental-features = nix-command flakes");
  });

  it("appends flakes enablement when experimental-features is incomplete", () => {
    const env = { HOME: tmpdir(), NIX_CONFIG: "experimental-features = nix-command\nfoo = bar" };
    const out = withFlakesEnv(env);
    expect(String(out.NIX_CONFIG || "")).toContain("experimental-features = nix-command flakes");
    expect(String(out.NIX_CONFIG || "")).toContain("foo = bar");
  });

  it("uses private XDG dirs when HOME is not writable", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "clawdlets-home-ro-"));
    const xdgParent = await mkdtemp(path.join(tmpdir(), "clawdlets-xdg-parent-"));
    const xdgDataHome = await mkdtemp(path.join(tmpdir(), "clawdlets-xdg-data-"));

    try {
      await chmod(homeDir, 0o555);
      const out = withFlakesEnv({
        HOME: homeDir,
        NIX_CONFIG: "",
        XDG_CACHE_HOME: path.join(xdgParent, "cache"),
        XDG_CONFIG_HOME: "",
        XDG_DATA_HOME: xdgDataHome,
        XDG_STATE_HOME: "",
      });

      const xdgRoot = path.join(tmpdir(), "clawdlets-xdg");
      expect(out.XDG_CACHE_HOME).toBe(path.join(xdgParent, "cache"));
      expect(out.XDG_CONFIG_HOME).toBe(path.join(xdgRoot, "config"));
      expect(out.XDG_DATA_HOME).toBe(xdgDataHome);
      expect(out.XDG_STATE_HOME).toBe(path.join(xdgRoot, "state"));

      expect(String(out.NIX_CONFIG || "")).toContain("experimental-features = nix-command flakes");
      expect(String(out.NIX_CONFIG || "")).toContain("use-xdg-base-directories = true");
    } finally {
      await chmod(homeDir, 0o700).catch(() => {});
      await rm(homeDir, { recursive: true, force: true });
      await rm(xdgParent, { recursive: true, force: true });
      await rm(xdgDataHome, { recursive: true, force: true });
    }
  });
});
