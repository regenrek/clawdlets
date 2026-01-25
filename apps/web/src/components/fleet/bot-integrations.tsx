import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { findEnvVarRefs } from "@clawdlets/core/lib/env-var-refs"
import { getKnownLlmProviders, getProviderRequiredEnvVars } from "@clawdlets/shared/lib/llm-provider-env"
import { RunLogTail } from "~/components/run-log-tail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { applyBotChannelPreset } from "~/sdk/bots"
import { configDotSet } from "~/sdk/config"
import { serverChannelsExecute, serverChannelsStart } from "~/sdk/server-channels"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getEnvMapping(params: {
  envVar: string
  fleetSecretEnv: unknown
  botSecretEnv: unknown
}): { secretName: string; scope: "bot" | "fleet" } | null {
  const envVar = params.envVar
  if (isPlainObject(params.botSecretEnv)) {
    const v = params.botSecretEnv[envVar]
    if (typeof v === "string" && v.trim()) return { secretName: v.trim(), scope: "bot" }
  }
  if (isPlainObject(params.fleetSecretEnv)) {
    const v = params.fleetSecretEnv[envVar]
    if (typeof v === "string" && v.trim()) return { secretName: v.trim(), scope: "fleet" }
  }
  return null
}

function suggestedSecretName(envVar: string, botId: string): string {
  if (envVar === "DISCORD_BOT_TOKEN") return `discord_token_${botId}`
  if (envVar === "TELEGRAM_BOT_TOKEN") return `telegram_bot_token_${botId}`
  if (envVar === "SLACK_BOT_TOKEN") return `slack_bot_token_${botId}`
  if (envVar === "SLACK_APP_TOKEN") return `slack_app_token_${botId}`
  return envVar.toLowerCase()
}

const SHAREABLE_ENV_VARS = (() => {
  const out = new Set<string>()
  for (const provider of getKnownLlmProviders()) {
    for (const envVar of getProviderRequiredEnvVars(provider)) out.add(envVar)
  }
  return out
})()

function isShareableEnvVar(envVar: string): boolean {
  return SHAREABLE_ENV_VARS.has(envVar)
}

function readChannelTokenWarnings(clawdbot: any): string[] {
  const warnings: string[] = []
  const channels = clawdbot?.channels
  if (!isPlainObject(channels)) return warnings
  const discordToken = (channels as any)?.discord?.token
  if (typeof discordToken === "string" && discordToken.trim() && !discordToken.includes("${")) {
    warnings.push("Discord token looks inline (avoid secrets in config; use ${DISCORD_BOT_TOKEN}).")
  }
  const telegramToken = (channels as any)?.telegram?.botToken
  if (typeof telegramToken === "string" && telegramToken.trim() && !telegramToken.includes("${")) {
    warnings.push("Telegram botToken looks inline (avoid secrets in config; use ${TELEGRAM_BOT_TOKEN}).")
  }
  const slackBotToken = (channels as any)?.slack?.botToken
  if (typeof slackBotToken === "string" && slackBotToken.trim() && !slackBotToken.includes("${")) {
    warnings.push("Slack botToken looks inline (avoid secrets in config; use ${SLACK_BOT_TOKEN}).")
  }
  const slackAppToken = (channels as any)?.slack?.appToken
  if (typeof slackAppToken === "string" && slackAppToken.trim() && !slackAppToken.includes("${")) {
    warnings.push("Slack appToken looks inline (avoid secrets in config; use ${SLACK_APP_TOKEN}).")
  }

  return warnings
}

function listEnabledChannels(clawdbot: any): string[] {
  const channels = clawdbot?.channels
  if (!isPlainObject(channels)) return []
  return Object.keys(channels)
    .filter((k) => {
      const entry = (channels as any)?.[k]
      if (!isPlainObject(entry)) return true
      if (entry.enabled === false) return false
      return true
    })
    .sort()
}

function formatMapping(mapping: { secretName: string; scope: "bot" | "fleet" } | null): string {
  if (!mapping) return "unwired"
  return `${mapping.secretName} (${mapping.scope})`
}

export function BotIntegrations(props: {
  projectId: string
  botId: string
  host: string
  clawdbot: unknown
  profile: unknown
  fleetSecretEnv: unknown
  canEdit: boolean
}) {
  const queryClient = useQueryClient()

  const envRefs = useMemo(() => findEnvVarRefs(props.clawdbot ?? {}), [props.clawdbot])
  const enabledChannels = useMemo(() => listEnabledChannels(props.clawdbot), [props.clawdbot])
  const tokenWarnings = useMemo(() => readChannelTokenWarnings(props.clawdbot), [props.clawdbot])

  const [draftSecretByEnvVar, setDraftSecretByEnvVar] = useState<Record<string, string>>({})

  useEffect(() => {
    setDraftSecretByEnvVar((prev) => {
      const next = { ...prev }
      for (const envVar of envRefs.vars) {
        if (!next[envVar]) next[envVar] = suggestedSecretName(envVar, props.botId)
      }
      return next
    })
  }, [envRefs.vars, props.botId])

  const applyPreset = useMutation({
    mutationFn: async (preset: "discord" | "telegram" | "slack" | "whatsapp") =>
      await applyBotChannelPreset({
        data: { projectId: props.projectId as Id<"projects">, botId: props.botId, preset },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("Failed to apply preset")
        return
      }
      toast.success("Preset applied")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
    },
    onError: (err) => toast.error(String(err)),
  })

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const runChannels = useMutation({
    mutationFn: async (params: {
      op: "status" | "login" | "logout" | "capabilities"
      channel?: string
      account?: string
      target?: string
      timeout?: string
      json?: boolean
      probe?: boolean
      verbose?: boolean
    }) => {
      if (!props.host.trim()) throw new Error("missing host")
      const started = await serverChannelsStart({
        data: {
          projectId: props.projectId as Id<"projects">,
          host: props.host,
          botId: props.botId,
          op: params.op,
        },
      })
      return { runId: started.runId, params }
    },
    onSuccess: (res) => {
      setRunId(res.runId)
      void serverChannelsExecute({
        data: {
          projectId: props.projectId as Id<"projects">,
          runId: res.runId,
          host: props.host,
          botId: props.botId,
          op: res.params.op,
          channel: res.params.channel || "",
          account: res.params.account || "",
          target: res.params.target || "",
          timeout: res.params.timeout || "10000",
          json: Boolean(res.params.json),
          probe: Boolean(res.params.probe),
          verbose: Boolean(res.params.verbose),
        },
      })
      toast.info(`Started channels ${res.params.op}`)
    },
    onError: (err) => toast.error(String(err)),
  })

  const wireEnv = useMutation({
    mutationFn: async (params: { envVar: string; scope: "bot" | "fleet"; secretName: string }) => {
      const envVar = params.envVar.trim()
      const secretName = params.secretName.trim()
      if (!envVar) throw new Error("missing env var")
      if (!secretName) throw new Error("missing secret name")

      const path =
        params.scope === "bot"
          ? `fleet.bots.${props.botId}.profile.secretEnv.${envVar}`
          : `fleet.secretEnv.${envVar}`

      return await configDotSet({
        data: {
          projectId: props.projectId as Id<"projects">,
          path,
          value: secretName,
          del: false,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("Failed to write mapping")
        return
      }
      toast.success("Secret wiring updated")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
    },
    onError: (err) => toast.error(String(err)),
  })

  const botSecretEnv = (props.profile as any)?.secretEnv

  const promoteToFleet = useMutation({
    mutationFn: async (params: { envVar: string; secretName: string }) => {
      const envVar = params.envVar.trim()
      const secretName = params.secretName.trim()
      if (!envVar) throw new Error("missing env var")
      if (!secretName) throw new Error("missing secret name")

      const fleetRes = await configDotSet({
        data: {
          projectId: props.projectId as Id<"projects">,
          path: `fleet.secretEnv.${envVar}`,
          value: secretName,
          del: false,
        },
      })
      if (!fleetRes.ok) throw new Error("Failed to promote mapping")

      if (isPlainObject(botSecretEnv) && typeof botSecretEnv[envVar] === "string") {
        const botRes = await configDotSet({
          data: {
            projectId: props.projectId as Id<"projects">,
            path: `fleet.bots.${props.botId}.profile.secretEnv.${envVar}`,
            del: true,
          },
        })
        if (!botRes.ok) throw new Error("Failed to clear bot mapping")
      }

      return { ok: true as const }
    },
    onSuccess: () => {
      toast.success("Promoted to fleet")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
    },
    onError: (err) => toast.error(String(err)),
  })

  const hasDiscord = enabledChannels.includes("discord")
  const hasTelegram = enabledChannels.includes("telegram")
  const hasSlack = enabledChannels.includes("slack")
  const hasWhatsApp = enabledChannels.includes("whatsapp")
  const discordMapping = getEnvMapping({ envVar: "DISCORD_BOT_TOKEN", fleetSecretEnv: props.fleetSecretEnv, botSecretEnv })
  const telegramMapping = getEnvMapping({ envVar: "TELEGRAM_BOT_TOKEN", fleetSecretEnv: props.fleetSecretEnv, botSecretEnv })
  const slackBotMapping = getEnvMapping({ envVar: "SLACK_BOT_TOKEN", fleetSecretEnv: props.fleetSecretEnv, botSecretEnv })
  const slackAppMapping = getEnvMapping({ envVar: "SLACK_APP_TOKEN", fleetSecretEnv: props.fleetSecretEnv, botSecretEnv })

  return (
    <div className="space-y-4">
      <div>
        <div className="font-medium">Integrations / Channels</div>
        <div className="text-xs text-muted-foreground">
          Driven by <code>fleet.bots.{props.botId}.clawdbot.channels</code>. Secrets are wired via env vars (no inline tokens).
        </div>
      </div>

      {tokenWarnings.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
          <div className="font-medium">Inline secret warnings</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {tokenWarnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2">
              Discord
              {hasDiscord ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">off</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              <code>DISCORD_BOT_TOKEN</code> → {formatMapping(discordMapping)}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || applyPreset.isPending}
            onClick={() => applyPreset.mutate("discord")}
          >
            Enable + wire
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2">
              Telegram
              {hasTelegram ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">off</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              <code>TELEGRAM_BOT_TOKEN</code> → {formatMapping(telegramMapping)}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || applyPreset.isPending}
            onClick={() => applyPreset.mutate("telegram")}
          >
            Enable + wire
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2">
              Slack
              {hasSlack ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">off</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              <code>SLACK_BOT_TOKEN</code> → {formatMapping(slackBotMapping)}
            </div>
            <div className="text-xs text-muted-foreground">
              <code>SLACK_APP_TOKEN</code> → {formatMapping(slackAppMapping)}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || applyPreset.isPending}
            onClick={() => applyPreset.mutate("slack")}
          >
            Enable + wire
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2">
              WhatsApp
              {hasWhatsApp ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">off</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">Requires login on the gateway host.</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canEdit || applyPreset.isPending}
              onClick={() => applyPreset.mutate("whatsapp")}
            >
              Enable
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canEdit || runChannels.isPending || !hasWhatsApp || !props.host.trim()}
              onClick={() => runChannels.mutate({ op: "login", channel: "whatsapp", verbose: true })}
            >
              Login
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canEdit || runChannels.isPending || !props.host.trim()}
          onClick={() => runChannels.mutate({ op: "status", probe: true })}
        >
          Channels status
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canEdit || runChannels.isPending || !hasWhatsApp || !props.host.trim()}
          onClick={() => runChannels.mutate({ op: "logout", channel: "whatsapp" })}
        >
          WhatsApp logout
        </Button>
        {!props.host.trim() ? (
          <span className="text-xs text-muted-foreground">
            Set <code>defaultHost</code> to run host operations.
          </span>
        ) : null}
      </div>

      {runId ? <RunLogTail runId={runId} /> : null}

      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer select-none text-sm font-medium">
          Secret wiring (advanced)
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({envRefs.vars.length} env vars referenced)
          </span>
        </summary>

        <div className="mt-4 space-y-3">
          {envRefs.vars.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No <code>${"{ENV}"}</code> refs found in this bot’s clawdbot config.
            </div>
          ) : (
            <div className="space-y-2">
              {envRefs.vars.map((envVar) => {
                const mapping = getEnvMapping({
                  envVar,
                  fleetSecretEnv: props.fleetSecretEnv,
                  botSecretEnv,
                })
                const draft = (draftSecretByEnvVar[envVar] || "").trim()
                const hasMapping = Boolean(mapping?.secretName)
                const canPromote = Boolean(mapping && mapping.scope === "bot" && isShareableEnvVar(envVar))
                return (
                  <div key={envVar} className="rounded-md border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          <code>{envVar}</code>
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                          {hasMapping ? (
                            <>
                              mapped to <code>{mapping!.secretName}</code> ({mapping!.scope})
                            </>
                          ) : (
                            <>missing mapping</>
                          )}
                          {canPromote ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!props.canEdit || promoteToFleet.isPending}
                              onClick={() => promoteToFleet.mutate({ envVar, secretName: mapping!.secretName })}
                            >
                              Promote to fleet
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {hasMapping ? <Badge variant="secondary">ok</Badge> : <Badge variant="destructive">missing</Badge>}
                    </div>

                    {!hasMapping ? (
                      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] items-end">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">Secret name</div>
                          <Input
                            value={draft}
                            onChange={(e) =>
                              setDraftSecretByEnvVar((prev) => ({ ...prev, [envVar]: e.target.value }))
                            }
                            disabled={!props.canEdit}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!props.canEdit || wireEnv.isPending || !draft}
                          onClick={() => wireEnv.mutate({ envVar, scope: "fleet", secretName: draft })}
                        >
                          Map (fleet)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!props.canEdit || wireEnv.isPending || !draft}
                          onClick={() => wireEnv.mutate({ envVar, scope: "bot", secretName: draft })}
                        >
                          Map (bot)
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
