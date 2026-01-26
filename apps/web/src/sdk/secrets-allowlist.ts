import {
  assertSecretsAreManaged as coreAssertSecretsAreManaged,
  buildManagedHostSecretNameAllowlist as coreBuildManagedHostSecretNameAllowlist,
} from "@clawdlets/core/lib/secrets-allowlist"

export function assertSecretsAreManaged(...args: Parameters<typeof coreAssertSecretsAreManaged>) {
  return coreAssertSecretsAreManaged(...args)
}

export function buildManagedHostSecretNameAllowlist(...args: Parameters<typeof coreBuildManagedHostSecretNameAllowlist>) {
  return coreBuildManagedHostSecretNameAllowlist(...args)
}
