import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import JSON5 from "json5"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { getKnownLlmProviders, getLlmProviderInfo } from "@clawdlets/core/lib/llm-provider-env"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { getClawdletsConfig, writeClawdletsConfigFile } from "~/sdk/config"
import { writeHostSecrets } from "~/sdk/secrets"

export const Route = createFileRoute("/projects/$projectId/setup/models")({
  component: ModelsSetup,
})

type ModelSecretRow = { key: string; secret: string; apiKey: string }

function ModelsSetup() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])
  const knownProviders = useMemo(() => getKnownLlmProviders(), [])

  const [modelSecrets, setModelSecrets] = useState<ModelSecretRow[]>([])
  const [botPrimaryModels, setBotPrimaryModels] = useState<Record<string, string>>({})
  const [botModelsJson5, setBotModelsJson5] = useState<Record<string, string>>({})
  const [modelsBot, setModelsBot] = useState("")
  const [secretsHost, setSecretsHost] = useState("")

  useEffect(() => {
    if (!config) return
    const entries = Object.entries((config.fleet?.modelSecrets || {}) as Record<string, string>)
    setModelSecrets(entries.map(([key, secret]) => ({ key, secret, apiKey: "" })))
    setSecretsHost(config.defaultHost || hosts[0] || "")

    const nextPrimary: Record<string, string> = {}
    const nextModels: Record<string, string> = {}
    for (const botId of bots) {
      const clawdbot = (config.fleet?.bots as any)?.[botId]?.clawdbot || {}
      nextPrimary[botId] = String(clawdbot?.agents?.defaults?.model?.primary || "")
      const models = clawdbot?.models
      nextModels[botId] = models && typeof models === "object" ? `${JSON.stringify(models, null, 2)}\n` : ""
    }
    setBotPrimaryModels(nextPrimary)
    setBotModelsJson5(nextModels)
  }, [bots, config, hosts])

  useEffect(() => {
    if (!bots.length) return
    if (modelsBot) return
    setModelsBot(bots[0] || "")
  }, [bots, modelsBot])

  const writeApiKeys = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")
      const host = (secretsHost || config.defaultHost || hosts[0] || "").trim()
      if (!host) throw new Error("missing host")

      const secrets: Record<string, string> = {}
      for (const row of modelSecrets) {
        const secretName = row.secret.trim()
        const apiKey = row.apiKey.trim()
        if (!secretName || !apiKey) continue
        secrets[secretName] = apiKey
      }
      if (Object.keys(secrets).length === 0) throw new Error("no API keys provided")

      return await writeHostSecrets({
        data: { projectId: projectId as Id<"projects">, host, secrets },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("Failed to write secrets")
        return
      }
      toast.success(`Wrote ${res.updated.length} secret(s)`)
      setModelSecrets((prev) => prev.map((r) => ({ ...r, apiKey: "" })))
    },
    onError: (err) => {
      toast.error(String(err))
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")

      const nextModelSecrets: Record<string, string> = {}
      for (const row of modelSecrets) {
        const k = row.key.trim().toLowerCase()
        const v = row.secret.trim()
        if (!k) continue
        nextModelSecrets[k] = v
      }

      const nextBots: Record<string, any> = { ...(config.fleet.bots as any) }
      for (const botId of bots) {
        const existing = nextBots[botId] || {}
        const clawdbot = existing.clawdbot && typeof existing.clawdbot === "object" && !Array.isArray(existing.clawdbot)
          ? { ...(existing.clawdbot as Record<string, unknown>) }
          : {}

        const primary = (botPrimaryModels[botId] || "").trim()
        if (primary) {
          const agents = clawdbot["agents"] && typeof clawdbot["agents"] === "object" && !Array.isArray(clawdbot["agents"])
            ? { ...(clawdbot["agents"] as Record<string, unknown>) }
            : {}
          const defaults = (agents as any)["defaults"] && typeof (agents as any)["defaults"] === "object" && !Array.isArray((agents as any)["defaults"])
            ? { ...((agents as any)["defaults"] as Record<string, unknown>) }
            : {}
          const model = (defaults as any)["model"] && typeof (defaults as any)["model"] === "object" && !Array.isArray((defaults as any)["model"])
            ? { ...((defaults as any)["model"] as Record<string, unknown>) }
            : {}
          ;(model as any)["primary"] = primary
          ;(defaults as any)["model"] = model
          ;(agents as any)["defaults"] = defaults
          clawdbot["agents"] = agents
        } else {
          const defaults = (clawdbot as any)?.agents?.defaults
          if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
            const model = (defaults as any)?.model
            if (model && typeof model === "object" && !Array.isArray(model)) {
              delete (model as any).primary
            }
          }
        }

        const modelsText = (botModelsJson5[botId] || "").trim()
        if (modelsText) {
          const parsed = JSON5.parse(modelsText) as unknown
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`models JSON5 must be an object (${botId})`)
          clawdbot["models"] = parsed as any
        } else {
          delete (clawdbot as any)["models"]
        }

        nextBots[botId] = { ...existing, clawdbot }
      }

      const next = {
        ...config,
        fleet: {
          ...config.fleet,
          modelSecrets: nextModelSecrets,
          bots: nextBots,
        },
      }

      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: "Update models" },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Validation failed")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Models</h1>
      <p className="text-muted-foreground">
        Configure model providers, API key mapping, and per-bot defaults.
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Model providers</div>
            <div className="text-xs text-muted-foreground">
              Stored as <code>fleet.modelSecrets</code> (provider key → secret name).
            </div>
            <div className="grid gap-4 md:grid-cols-[260px_1fr] items-end">
              <div className="space-y-2">
                <LabelWithHelp help={setupFieldHelp.models?.writeApiKeysHost}>
                  Write API keys to host
                </LabelWithHelp>
                <NativeSelect value={secretsHost} onChange={(e) => setSecretsHost(e.target.value)}>
                  {hosts.map((h) => (
                    <NativeSelectOption key={h} value={h}>
                      {h}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" disabled={writeApiKeys.isPending} onClick={() => writeApiKeys.mutate()}>
                  Write API keys
                </Button>
                <div className="text-xs text-muted-foreground">
                  Tokens are written to encrypted secrets on disk (never stored in Convex).
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              <datalist id="llm-provider-keys">
                {knownProviders.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              {modelSecrets.length === 0 ? (
                <div className="text-muted-foreground">No model providers configured.</div>
              ) : null}
              {modelSecrets.map((row, idx) => {
                const info = getLlmProviderInfo(row.key)
                const providerKey = row.key.trim()
                const hint =
                  !row.key.trim()
                    ? ""
                    : info?.auth === "oauth"
                      ? "OAuth (no API key env required)"
                      : info?.secretEnvVars?.length
                        ? `env: ${info.secretEnvVars.join(", ")}`
                        : "unknown provider"
                return (
                  <div key={`${idx}-${row.key}`} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-start">
                    <div className="space-y-1">
                      <LabelWithHelp help={setupFieldHelp.models?.providerKey}>
                        Provider key
                      </LabelWithHelp>
                      <Input
                        value={row.key}
                        onChange={(e) =>
                          setModelSecrets((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                          )
                        }
                        aria-label={`model provider key ${idx + 1}`}
                        list="llm-provider-keys"
                        placeholder="openai | anthropic | minimax | …"
                      />
                      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
                      {info?.auth === "oauth" && providerKey ? (
                        <div className="text-xs text-muted-foreground">
                          OAuth login on the host: <code>clawdbot auth login {providerKey}</code>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <LabelWithHelp help={setupFieldHelp.models?.secretName}>
                        Secret name
                      </LabelWithHelp>
                      <Input
                        value={row.secret}
                        onChange={(e) =>
                          setModelSecrets((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, secret: e.target.value } : r)),
                          )
                        }
                        aria-label={`model provider secret ${idx + 1}`}
                        placeholder="provider_api_key"
                      />
                      <div className="text-xs text-muted-foreground">
                        Secret lives under <code>secrets/hosts/&lt;host&gt;</code>.
                      </div>
                    </div>
                    <div className="space-y-1">
                      <LabelWithHelp help={setupFieldHelp.models?.apiKey}>
                        API key (optional)
                      </LabelWithHelp>
                      <Input
                        type="password"
                        value={row.apiKey}
                        onChange={(e) =>
                          setModelSecrets((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, apiKey: e.target.value } : r)),
                          )
                        }
                        aria-label={`model provider api key ${idx + 1}`}
                        placeholder="leave blank to keep existing"
                        disabled={info?.auth === "oauth"}
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={() => setModelSecrets((prev) => prev.filter((_, i) => i !== idx))}>
                      Remove
                    </Button>
                  </div>
                )
              })}
              <Button type="button" variant="outline" onClick={() => setModelSecrets((prev) => [...prev, { key: "", secret: "", apiKey: "" }])}>
                Add provider
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Bot defaults</div>
            <div className="text-xs text-muted-foreground">
              Writes into <code>fleet.bots.&lt;bot&gt;.clawdbot.agents.defaults.model.primary</code> (overrides host default).
            </div>
            <div className="grid gap-3">
              {bots.length === 0 ? (
                <div className="text-muted-foreground">No bots.</div>
              ) : (
                bots.map((botId) => (
                  <div key={botId} className="grid gap-2 md:grid-cols-[180px_1fr] items-center">
                    <LabelWithHelp help={setupFieldHelp.models?.primaryModel}>
                      {botId} model.primary
                    </LabelWithHelp>
                    <Input
                      value={botPrimaryModels[botId] || ""}
                      onChange={(e) => setBotPrimaryModels((prev) => ({ ...prev, [botId]: e.target.value }))}
                      aria-label={`${botId} model primary`}
                      placeholder="provider/model"
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Advanced: per-bot models config (JSON5)</div>
            <div className="text-xs text-muted-foreground">
              Stored as <code>fleet.bots.&lt;bot&gt;.clawdbot.models</code>. Avoid secrets here; use modelSecrets + Secrets.
            </div>

            <div className="space-y-2 max-w-sm">
              <LabelWithHelp help={setupFieldHelp.models?.botSelect}>
                Bot
              </LabelWithHelp>
              <NativeSelect value={modelsBot} onChange={(e) => setModelsBot(e.target.value)}>
                {bots.map((b) => (
                  <NativeSelectOption key={b} value={b}>
                    {b}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            {modelsBot ? (
              <div className="space-y-2">
                <LabelWithHelp help={setupFieldHelp.models?.modelsJson5}>
                  clawdbot.models (JSON5)
                </LabelWithHelp>
                <Textarea
                  value={botModelsJson5[modelsBot] || ""}
                  onChange={(e) => setBotModelsJson5((prev) => ({ ...prev, [modelsBot]: e.target.value }))}
                  className="font-mono min-h-[220px]"
                  placeholder={`{\n  mode: \"merge\",\n  providers: {\n    minimax: {\n      baseUrl: \"https://api.minimax.io/anthropic\",\n      apiKey: \"${"${MINIMAX_API_KEY}"}\",\n      api: \"anthropic-messages\",\n      models: [ { id: \"MiniMax-M2.1\" } ]\n    }\n  }\n}\n`}
                />
              </div>
            ) : (
              <div className="text-muted-foreground">No bot selected.</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              Save models
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })}
            >
              Reload
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
