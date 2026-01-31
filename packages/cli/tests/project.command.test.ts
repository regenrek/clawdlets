import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
const downloadTemplateMock = vi.fn();
const captureMock = vi.fn();
const runMock = vi.fn();
const noteMock = vi.fn();
const outroMock = vi.fn();

vi.mock("@clack/prompts", () => ({
  note: noteMock,
  outro: outroMock,
  intro: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: () => false,
}));

vi.mock("giget", () => ({
  downloadTemplate: downloadTemplateMock,
}));

vi.mock("@clawdlets/core/lib/run", () => ({
  capture: captureMock,
  run: runMock,
}));

describe("project init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureMock.mockResolvedValue(undefined);
    runMock.mockResolvedValue(undefined);
  });

  function writeTemplate(dir: string) {
    fs.mkdirSync(path.join(dir, "fleet"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "fleet", "clawdlets.json"),
      JSON.stringify(
        {
          schemaVersion: 8,
          fleet: { botOrder: [], bots: {} },
          hosts: {
            "clawdbot-fleet-host": {
              cache: { netrc: { enable: true } },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "_gitignore"), "node_modules\n", "utf8");
    fs.writeFileSync(path.join(dir, "README.md"), "__PROJECT_NAME__", "utf8");
  }

  it("dry-run prints planned files", async () => {
    const temp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-template-"));
    writeTemplate(temp);
    downloadTemplateMock.mockResolvedValue({ dir: temp });
    const dest = path.join(tmpdir(), "clawdlets-project-dry");
    const { project } = await import("../src/commands/project.js");
    await project.subCommands?.init?.run?.({ args: { dir: dest, dryRun: true, gitInit: false } } as any);
    expect(noteMock).toHaveBeenCalled();
    expect(outroMock).toHaveBeenCalledWith("dry-run");
  });

  it("writes files and substitutes placeholders", async () => {
    const temp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-template-"));
    writeTemplate(temp);
    downloadTemplateMock.mockResolvedValue({ dir: temp });
    const dest = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-project-"));
    const target = path.join(dest, "my-fleet");
    const { project } = await import("../src/commands/project.js");
    await project.subCommands?.init?.run?.({ args: { dir: target, gitInit: false } } as any);
    expect(fs.existsSync(path.join(target, ".gitignore"))).toBe(true);
    const readme = fs.readFileSync(path.join(target, "README.md"), "utf8");
    expect(readme).toMatch(/my-fleet/);
    const cfg = JSON.parse(fs.readFileSync(path.join(target, "fleet", "clawdlets.json"), "utf8"));
    expect(cfg.hosts["clawdbot-fleet-host"].cache.netrc.enable).toBe(false);
  });

  it("rejects missing --dir", async () => {
    const { project } = await import("../src/commands/project.js");
    await expect(project.subCommands?.init?.run?.({ args: {} } as any)).rejects.toThrow(/missing --dir/i);
  });

  it("rejects non-empty target dir", async () => {
    const temp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-project-"));
    fs.writeFileSync(path.join(temp, "README.md"), "existing", "utf8");
    const { project } = await import("../src/commands/project.js");
    await expect(project.subCommands?.init?.run?.({ args: { dir: temp } } as any)).rejects.toThrow(/not empty/i);
  });

  it("requires TTY for interactive mode", async () => {
    const temp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-template-"));
    writeTemplate(temp);
    downloadTemplateMock.mockResolvedValue({ dir: temp });
    const dest = path.join(tmpdir(), "clawdlets-project-tty");
    const stdoutTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const { project } = await import("../src/commands/project.js");
    await expect(project.subCommands?.init?.run?.({ args: { dir: dest, interactive: true, gitInit: false } } as any)).rejects.toThrow(
      /requires a TTY/i,
    );
    Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true });
  });

  it("notes when git is unavailable in interactive mode", async () => {
    const temp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-template-"));
    writeTemplate(temp);
    downloadTemplateMock.mockResolvedValue({ dir: temp });
    captureMock.mockRejectedValueOnce(new Error("git missing"));
    const dest = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-project-"));
    const target = path.join(dest, "my-fleet");
    const stdoutTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const { project } = await import("../src/commands/project.js");
    await project.subCommands?.init?.run?.({ args: { dir: target, gitInit: true, interactive: true } } as any);
    expect(noteMock).toHaveBeenCalledWith(expect.stringMatching(/git not available/i), "gitInit");
    Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true });
  });

  it("finds nested template root", async () => {
    const temp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-template-"));
    const nested = path.join(temp, "nested");
    fs.mkdirSync(nested, { recursive: true });
    writeTemplate(nested);
    downloadTemplateMock.mockResolvedValue({ dir: temp });
    const dest = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-project-"));
    const target = path.join(dest, "my-fleet");
    const { project } = await import("../src/commands/project.js");
    await project.subCommands?.init?.run?.({ args: { dir: target, gitInit: false } } as any);
    expect(fs.existsSync(path.join(target, "fleet", "clawdlets.json"))).toBe(true);
  });
});
