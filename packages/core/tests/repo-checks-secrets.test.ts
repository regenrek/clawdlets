import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findClawdbotSecretViolations } from "../src/doctor/repo-checks-secrets";

async function setupRepo(): Promise<{ dir: string; botDir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "clawdlets-repo-checks-secrets-"));
  const botDir = path.join(dir, "fleet", "workspaces", "bots", "bot1");
  await mkdir(botDir, { recursive: true });
  return { dir, botDir };
}

describe("repo-checks-secrets", () => {
  it("flags obvious secrets in clawdbot.json5", async () => {
    const { dir, botDir } = await setupRepo();
    try {
      await writeFile(path.join(botDir, "clawdbot.json5"), '{ "token": "sk-1234567890abcdefghijklmnop" }\n', "utf8");
      const scan = findClawdbotSecretViolations(dir);
      expect(scan.violations.length).toBe(1);
      expect(scan.violations[0]?.label).toBe("openai sk- token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scans $include targets within repo root", async () => {
    const { dir, botDir } = await setupRepo();
    try {
      await writeFile(path.join(botDir, "included.json5"), '{ "token": "sk-1234567890abcdefghijklmnop" }\n', "utf8");
      await writeFile(path.join(botDir, "clawdbot.json5"), '{ $include: "./included.json5" }\n', "utf8");

      const scan = findClawdbotSecretViolations(dir);
      expect(scan.violations.length).toBe(1);
      expect(scan.violations[0]?.file).toBe(path.join(botDir, "included.json5"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not follow $include targets outside repo root", async () => {
    const { dir, botDir } = await setupRepo();
    const outsideDir = await mkdtemp(path.join(tmpdir(), "clawdlets-repo-checks-secrets-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "outside.json5");
      await writeFile(outsideFile, '{ "token": "sk-1234567890abcdefghijklmnop" }\n', "utf8");
      await writeFile(path.join(botDir, "clawdbot.json5"), `{ $include: ${JSON.stringify(outsideFile)} }\n`, "utf8");

      const scan = findClawdbotSecretViolations(dir);
      expect(scan.violations.length).toBe(0);
      expect(scan.files).toEqual([path.join(botDir, "clawdbot.json5")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("does not follow $include symlinks that escape repo root", async () => {
    if (process.platform === "win32") return;

    const { dir, botDir } = await setupRepo();
    const outsideDir = await mkdtemp(path.join(tmpdir(), "clawdlets-repo-checks-secrets-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "outside.json5");
      await writeFile(outsideFile, '{ "token": "sk-1234567890abcdefghijklmnop" }\n', "utf8");

      const escapePath = path.join(botDir, "escape.json5");
      try {
        await symlink(outsideFile, escapePath);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | null)?.code;
        if (code === "EPERM") return;
        throw e;
      }

      await writeFile(path.join(botDir, "clawdbot.json5"), '{ $include: "./escape.json5" }\n', "utf8");

      const scan = findClawdbotSecretViolations(dir);
      expect(scan.violations.length).toBe(0);
      expect(scan.files).toEqual([path.join(botDir, "clawdbot.json5")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

