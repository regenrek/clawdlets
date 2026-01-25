import fs from "node:fs"
import path from "node:path"

import { normalizeTemplateSource } from "@clawdlets/core/lib/template-source"

type TemplateSourceConfig = {
  repo?: string
  path?: string
  ref?: string
}

function looksLikeRepoShorthand(spec: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spec)
}

function assertSupportedTemplateSpec(spec: string): void {
  const trimmed = spec.trim()
  if (!trimmed) throw new Error("templateSpec missing")
  if (looksLikeRepoShorthand(trimmed)) {
    throw new Error(
      "templateSpec must be a giget spec (not owner/repo). Example: github:owner/repo/templates/default#<40-hex-sha>",
    )
  }
  if (
    !(
      trimmed.startsWith("github:") ||
      trimmed.startsWith("gh:") ||
      trimmed.startsWith("file:")
    )
  ) {
    throw new Error(
      "templateSpec must start with github:, gh:, or file: (example: github:owner/repo/templates/default#<40-hex-sha>)",
    )
  }
}

function findTemplateSourceConfigPath(): string {
  let dir = process.cwd()
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, "config", "template-source.json")
    if (fs.existsSync(candidate)) return candidate
    const next = path.dirname(dir)
    if (next === dir) break
    dir = next
  }
  throw new Error("template source config missing (expected config/template-source.json)")
}

function loadTemplateSourceConfig(): TemplateSourceConfig {
  const configPath = findTemplateSourceConfigPath()
  const raw = fs.readFileSync(configPath, "utf8")
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`template source config invalid: ${configPath}`)
  }
  const cfg = parsed as TemplateSourceConfig
  return cfg
}

function resolveDefaultTemplateSpec(): string {
  const cfg = loadTemplateSourceConfig()
  return normalizeTemplateSource({
    repo: String(cfg.repo || ""),
    path: String(cfg.path || ""),
    ref: String(cfg.ref || ""),
  }).spec
}

let cachedDefaultTemplateSpec: string | null = null
function getDefaultTemplateSpec(): string {
  if (cachedDefaultTemplateSpec) return cachedDefaultTemplateSpec
  cachedDefaultTemplateSpec = resolveDefaultTemplateSpec()
  return cachedDefaultTemplateSpec
}

export function resolveTemplateSpec(input?: unknown): string {
  const raw = typeof input === "string" ? input.trim() : ""
  const fromEnv = String(process.env["CLAWDLETS_TEMPLATE_SPEC"] || "").trim()
  const spec = raw || fromEnv || getDefaultTemplateSpec()
  assertSupportedTemplateSpec(spec)
  return spec
}
