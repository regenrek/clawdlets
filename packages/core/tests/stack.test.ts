import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("stack", () => {
  let repoRoot = "";

  beforeAll(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-stack-"));
    await writeFile(path.join(repoRoot, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/origin-repo.git"], { cwd: repoRoot });
    await mkdir(path.join(repoRoot, ".clawdlets"), { recursive: true });
    await mkdir(path.join(repoRoot, ".clawdlets", "dist"), { recursive: true });
	    await writeFile(
	      path.join(repoRoot, ".clawdlets", "stack.json"),
	      JSON.stringify(
	        {
	          schemaVersion: 3,
	          base: { flake: "github:example/repo" },
	          envFile: ".env",
	          hosts: {
	            "clawdbot-fleet-host": {
	              flakeHost: "clawdbot-fleet-host",
	              targetHost: "admin@100.64.0.1",
	              hetzner: { serverType: "cx43" },
	              opentofu: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
	              secrets: { localDir: "secrets/hosts/clawdbot-fleet-host", remoteDir: "/var/lib/clawdlets/secrets/hosts/clawdbot-fleet-host" },
	            },
	          },
	        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(path.join(repoRoot, ".clawdlets", ".env"), "HCLOUD_TOKEN=token\n", "utf8");
  });

  afterAll(async () => {
    try {
      await rm(repoRoot, { recursive: true, force: true });
    } catch {}
  });

	  it("loads stack.json from default stack dir", async () => {
	    const { loadStack } = await import("../src/stack");
	    const { stack, layout } = loadStack({ cwd: repoRoot });
	    expect(layout.repoRoot).toBe(repoRoot);
	    expect(layout.stackFile.endsWith(path.join(".clawdlets", "stack.json"))).toBe(true);
	    expect(stack.schemaVersion).toBe(3);
	    expect(stack.base?.flake).toBe("github:example/repo");
	    expect(Object.keys(stack.hosts)).toEqual(["clawdbot-fleet-host"]);
	  });

  it("rejects unsafe host keys in stack.json", async () => {
    const stackPath = path.join(repoRoot, ".clawdlets", "stack.json");
    const original = await readFile(stackPath, "utf8");
	    await writeFile(
	      stackPath,
	      JSON.stringify(
	        {
	          schemaVersion: 3,
	          envFile: ".env",
	          hosts: {
	            "../pwn": {
	              flakeHost: "clawdbot-fleet-host",
	              targetHost: "admin@100.64.0.1",
	              hetzner: { serverType: "cx43" },
	              opentofu: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
	              secrets: { localDir: "secrets/hosts/clawdbot-fleet-host", remoteDir: "/var/lib/clawdlets/secrets/hosts/clawdbot-fleet-host" },
	            },
	          },
	        },
        null,
        2,
      ),
      "utf8",
    );

    const { loadStack } = await import("../src/stack");
    try {
      expect(() => loadStack({ cwd: repoRoot })).toThrow(/invalid host name/i);
    } finally {
      await writeFile(stackPath, original, "utf8");
    }
  });

  it("loads env file relative to stack dir when stack.envFile is relative", async () => {
    const { loadStack, loadStackEnv } = await import("../src/stack");
	    await writeFile(
	      path.join(repoRoot, ".clawdlets", "stack.json"),
	      JSON.stringify(
	        {
	          schemaVersion: 3,
	          base: { flake: "github:example/repo" },
	          envFile: ".env",
	          hosts: {
	            "clawdbot-fleet-host": {
	              flakeHost: "clawdbot-fleet-host",
	              targetHost: "admin@100.64.0.1",
	              hetzner: { serverType: "cx43" },
	              opentofu: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
	              secrets: { localDir: "secrets/hosts/clawdbot-fleet-host", remoteDir: "/var/lib/clawdlets/secrets/hosts/clawdbot-fleet-host" },
	            },
	          },
	        },
        null,
        2,
      ),
      "utf8",
    );
    const { stack } = loadStack({ cwd: repoRoot });
    const loaded = loadStackEnv({ cwd: repoRoot, envFile: stack.envFile });
    expect(loaded.envFile).toBe(path.join(repoRoot, ".clawdlets", ".env"));
    expect(loaded.env.HCLOUD_TOKEN).toBe("token");
  });

  it("allows missing base.flake and can infer from git origin", async () => {
    const { loadStack, resolveStackBaseFlake } = await import("../src/stack");
    const stackPath = path.join(repoRoot, ".clawdlets", "stack.json");
	    await writeFile(
	      stackPath,
	      JSON.stringify(
	        {
	          schemaVersion: 3,
	          envFile: ".env",
	          hosts: {
	            "clawdbot-fleet-host": {
	              flakeHost: "clawdbot-fleet-host",
	              targetHost: "admin@100.64.0.1",
	              hetzner: { serverType: "cx43" },
	              opentofu: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
	              secrets: { localDir: "secrets/hosts/clawdbot-fleet-host", remoteDir: "/var/lib/clawdlets/secrets/hosts/clawdbot-fleet-host" },
	            },
	          },
	        },
        null,
        2,
      ),
      "utf8",
    );
    const { stack } = loadStack({ cwd: repoRoot });
    expect(stack.base?.flake).toBeUndefined();
    const resolved = await resolveStackBaseFlake({ repoRoot, stack });
    expect(resolved).toEqual({ flake: "github:acme/origin-repo", source: "origin" });
  });
});
