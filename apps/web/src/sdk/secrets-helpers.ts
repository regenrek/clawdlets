import type { ClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"

type ResolveHostOptions = { requireKnownHost?: boolean }

export function resolveHostFromConfig(
  config: ClawdletsConfig,
  host: string | null | undefined,
  options: ResolveHostOptions = {},
): string {
  const resolved = host || config.defaultHost || ""
  if (!resolved) throw new Error("missing host")
  if (options.requireKnownHost && !config.hosts[resolved]) throw new Error(`unknown host: ${resolved}`)
  return resolved
}
