import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets-plan"
import type { ClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"

export function buildManagedHostSecretNameAllowlist(params: {
  config: ClawdletsConfig
  host: string
}): Set<string> {
  const host = params.host.trim()
  const secretsPlan = buildFleetSecretsPlan({ config: params.config, hostName: host })
  const names = new Set<string>()
  for (const spec of secretsPlan.required || []) names.add(spec.name)
  for (const spec of secretsPlan.optional || []) names.add(spec.name)
  for (const name of secretsPlan.hostSecretNamesRequired || []) names.add(name)
  return names
}

export function assertSecretsAreManaged(params: {
  allowlist: Set<string>
  secrets: Record<string, string>
  allowUnmanaged?: boolean
}): void {
  if (params.allowUnmanaged) return
  const unmanaged = Object.keys(params.secrets).filter((name) => !params.allowlist.has(name))
  if (unmanaged.length === 0) return
  const sample = unmanaged.slice(0, 3).join(", ")
  throw new Error(`unmanaged secret name(s): ${sample} (add to fleet.secretEnv/secretFiles or enable Advanced)`)
}
