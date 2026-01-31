import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Keep tests hermetic across machines:
 * - many unit tests use /tmp paths (or os.tmpdir())
 * - production uses ~/.clawdlets/projects by default
 *
 * If a developer has CLAWDLETS_WORKSPACE_ROOTS set locally, it would otherwise
 * override the defaults and make tests fail with "path outside allowed workspace roots".
 */
const defaultClawdletsProjectsRoot = path.join(os.homedir(), ".clawdlets", "projects")
try {
  fs.mkdirSync(defaultClawdletsProjectsRoot, { recursive: true })
} catch {
  // ignore mkdir failures; /tmp roots still keep tests working
}

const roots = new Set<string>([
  defaultClawdletsProjectsRoot,
  os.tmpdir(),
  "/tmp",
])

// Preserve any existing roots, but always include tmp + default.
const existing = String(process.env.CLAWDLETS_WORKSPACE_ROOTS || "").trim()
if (existing) {
  for (const entry of existing.split(path.delimiter)) {
    const trimmed = entry.trim()
    if (trimmed) roots.add(trimmed)
  }
}

process.env.CLAWDLETS_WORKSPACE_ROOTS = Array.from(roots).join(path.delimiter)

