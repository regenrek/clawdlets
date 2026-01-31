import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import { makeConfig } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const resolveGitRevMock = vi.fn();
const createSecretsTarMock = vi.fn();

vi.mock("@clawdlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawdlets/core/lib/secrets-tar", () => ({
  createSecretsTar: createSecretsTarMock,
}));

describe("release commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("release manifest build writes a v1 manifest", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha" });
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", config });
    resolveGitRevMock.mockResolvedValue("a".repeat(40));

    const tarPath = path.join(tmpdir(), "secrets-alpha.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "b".repeat(64), files: ["x.yaml"] });

    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-release-"));
    const outPath = path.join(dir, "deploy", "alpha", "staging", "1.json");

    const { releaseManifest } = await import("../src/commands/release/manifest.js");
    await releaseManifest.subCommands.build.run({
      args: {
        host: "alpha",
        channel: "staging",
        releaseId: "1",
        issuedAt: "2026-01-31T00:00:00Z",
        requiredFeature: ["apply-manifest-v1"],
        toplevel: "/nix/store/abcd1234",
        out: outPath,
      },
    } as any);

    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.host).toBe("alpha");
    expect(parsed.channel).toBe("staging");
    expect(parsed.releaseId).toBe(1);
    expect(parsed.secrets?.digest).toBe("b".repeat(64));
  });

  it("release pointer write writes latest.json", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha" });
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", config });

    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-pointer-"));
    const outPath = path.join(dir, "deploy", "alpha", "prod", "latest.json");

    const { releasePointer } = await import("../src/commands/release/pointer.js");
    await releasePointer.subCommands.write.run({
      args: {
        host: "alpha",
        channel: "prod",
        releaseId: "9",
        out: outPath,
      },
    } as any);

    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(parsed.releaseId).toBe(9);
    expect(parsed.file).toBe("9.json");
  });

  it("release manifest promote rewrites channel and releaseId", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha" });
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", config });

    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-promote-"));
    const inPath = path.join(dir, "deploy", "alpha", "staging", "1.json");
    fs.mkdirSync(path.dirname(inPath), { recursive: true });
    fs.writeFileSync(
      inPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          host: "alpha",
          system: "x86_64-linux",
          channel: "staging",
          releaseId: 1,
          issuedAt: "2026-01-01T00:00:00.000Z",
          rev: "a".repeat(40),
          toplevel: "/nix/store/abcd1234",
          secrets: { digest: "b".repeat(64) },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const outPath = path.join(dir, "deploy", "alpha", "prod", "2.json");
    const { releaseManifest } = await import("../src/commands/release/manifest.js");
    await releaseManifest.subCommands.promote.run({
      args: {
        host: "alpha",
        in: inPath,
        channel: "prod",
        releaseId: "2",
        issuedAt: "2026-01-31T00:00:00Z",
        out: outPath,
      },
    } as any);

    expect(fs.existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(parsed.host).toBe("alpha");
    expect(parsed.channel).toBe("prod");
    expect(parsed.releaseId).toBe(2);
    expect(parsed.toplevel).toBe("/nix/store/abcd1234");
    expect(parsed.secrets?.digest).toBe("b".repeat(64));
  });
});
