import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises"

import { assertRepoRootPath, resolveUserPath, resolveWorkspacePath } from "../src/server/paths"

describe("resolveUserPath", () => {
  it("expands ~ and ~/ paths", () => {
    expect(resolveUserPath("~")).toBe(os.homedir())
    expect(resolveUserPath("~/clawdlets")).toBe(path.join(os.homedir(), "clawdlets"))
  })

  it("resolves relative paths from cwd", () => {
    const cwd = process.cwd()
    expect(resolveUserPath("config/test.json")).toBe(path.resolve(cwd, "config/test.json"))
  })

  it("accepts absolute paths", () => {
    const absolute = path.resolve("/tmp")
    expect(resolveUserPath(absolute)).toBe(absolute)
  })

  it("rejects empty or null-byte paths", () => {
    expect(() => resolveUserPath(" ")).toThrow(/path required/i)
    expect(() => resolveUserPath("bad\u0000path")).toThrow(/invalid path/i)
  })
})

describe("workspace path validation", () => {
  let workspaceRoot = ""

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clawdlets-workspace-"))
    vi.stubEnv("CLAWDLETS_WORKSPACE_ROOTS", workspaceRoot)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("accepts repo root within workspace", async () => {
    const repoRoot = path.join(workspaceRoot, "repo1")
    await mkdir(path.join(repoRoot, "fleet"), { recursive: true })
    await writeFile(path.join(repoRoot, "fleet", "clawdlets.json"), "{}\n", "utf8")
    const resolved = resolveWorkspacePath(repoRoot, { requireRepoLayout: true })
    expect(resolved).toBe(await realpath(repoRoot))
  })

  it("rejects paths outside workspace roots", () => {
    expect(() => resolveWorkspacePath("/etc", { allowMissing: false })).toThrow(/workspace roots/i)
  })

  it("rejects traversal that escapes workspace", () => {
    const candidate = path.join(workspaceRoot, "..", "etc")
    expect(() => resolveWorkspacePath(candidate, { allowMissing: true })).toThrow(/workspace roots/i)
  })

  it("dedupes duplicate workspace roots", async () => {
    vi.stubEnv("CLAWDLETS_WORKSPACE_ROOTS", `${workspaceRoot}${path.delimiter}${workspaceRoot}/.`)
    const repoRoot = path.join(workspaceRoot, "repo-dup")
    await mkdir(repoRoot, { recursive: true })
    const resolved = resolveWorkspacePath(repoRoot, { allowMissing: false })
    expect(resolved).toBe(await realpath(repoRoot))
  })

  it("rejects non-directory repo roots", async () => {
    const filePath = path.join(workspaceRoot, "not-a-dir")
    await writeFile(filePath, "x", "utf8")
    expect(() => assertRepoRootPath(filePath, { allowMissing: false })).toThrow(/directory/i)
  })

  it("rejects null bytes in assertRepoRootPath", () => {
    expect(() => assertRepoRootPath("/tmp/bad\u0000path", { allowMissing: true })).toThrow(/invalid path/i)
  })

  it("throws when workspace roots are missing", () => {
    const missingRoot = path.join(workspaceRoot, "missing-root")
    vi.stubEnv("CLAWDLETS_WORKSPACE_ROOTS", missingRoot)
    expect(() => resolveWorkspacePath("/tmp", { allowMissing: true })).toThrow(/workspace roots not configured/i)
  })

  it("rejects symlink escape", async () => {
    const linkPath = path.join(workspaceRoot, "link-out")
    await symlink("/etc", linkPath)
    expect(() => resolveWorkspacePath(linkPath, { allowMissing: false })).toThrow(/workspace roots/i)
  })

  it("rejects missing leaf under symlink parent with allowMissing", async () => {
    const linkPath = path.join(workspaceRoot, "link-out-missing")
    await symlink("/etc", linkPath)
    const target = path.join(linkPath, "child", "leaf")
    expect(() => resolveWorkspacePath(target, { allowMissing: true })).toThrow(/workspace roots/i)
  })

  it("validates repo layout via assertRepoRootPath", async () => {
    const repoRoot = path.join(workspaceRoot, "repo2")
    await mkdir(repoRoot, { recursive: true })
    expect(() => assertRepoRootPath(repoRoot, { allowMissing: false, requireRepoLayout: true })).toThrow(
      /clawdlets\.json/i,
    )
  })
})
