import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"

import { createServerFn } from "@tanstack/react-start"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import {
  getRepoLayout,
  getHostExtraFilesKeyPath,
  getHostExtraFilesSecretsDir,
  getHostEncryptedAgeKeyFile,
  getHostSecretFile,
} from "@clawdlets/core/repo-layout"
import { writeFileAtomic } from "@clawdlets/core/lib/fs-safe"
import { sopsEncryptYamlToFile } from "@clawdlets/core/lib/sops"
import { upsertYamlScalarLine } from "@clawdlets/core/lib/yaml-scalar"
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds"
import { assertSecretsAreManaged, buildManagedHostSecretNameAllowlist } from "@clawdlets/core/lib/secrets-allowlist"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseWriteHostSecretsInput } from "~/sdk/serverfn-validators"

export const writeHostSecrets = createServerFn({ method: "POST" })
  .inputValidator(parseWriteHostSecretsInput)
  .handler(async ({ data }) => {
    const host = data.host.trim()
    if (!host) throw new Error("missing host")

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawdletsConfig({ repoRoot })
    if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)

    const allowlist = buildManagedHostSecretNameAllowlist({ config, host })
    assertSecretsAreManaged({ allowlist, secrets: data.secrets })

    const layout = getRepoLayout(repoRoot)
    if (!fsSync.existsSync(layout.sopsConfigPath)) {
      throw new Error("missing sops config (run Secrets → Init for this host first)")
    }
    if (!fsSync.existsSync(getHostEncryptedAgeKeyFile(layout, host))) {
      throw new Error("missing host age key (run Secrets → Init for this host first)")
    }
    if (!fsSync.existsSync(getHostExtraFilesKeyPath(layout, host))) {
      throw new Error("missing extra-files key (run Secrets → Init for this host first)")
    }

    const loaded = loadDeployCreds({ cwd: repoRoot })
    const nix = { nixBin: String(loaded.values.NIX_BIN || "nix").trim() || "nix", cwd: repoRoot, dryRun: false } as const

    const extraFilesSecretsDir = getHostExtraFilesSecretsDir(layout, host)
    const updated: string[] = []

    for (const [secretName, secretValue] of Object.entries(data.secrets)) {
      const outPath = getHostSecretFile(layout, host, secretName)
      const plaintextYaml = upsertYamlScalarLine({ text: "\n", key: secretName, value: secretValue }) + "\n"
      await sopsEncryptYamlToFile({ plaintextYaml, outPath, configPath: layout.sopsConfigPath, nix })
      const encrypted = await fs.readFile(outPath, "utf8")
      await writeFileAtomic(path.join(extraFilesSecretsDir, `${secretName}.yaml`), encrypted, { mode: 0o400 })
      updated.push(secretName)
    }

    if (updated.length > 0) {
      await client.mutation(api.auditLogs.append, {
        projectId: data.projectId,
        action: "secrets.write",
        target: { host },
        data: { secrets: updated },
      })
    }

    return { ok: true as const, updated }
  })
