import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { getClawdletsConfig, writeClawdletsConfigFile } from "~/sdk/config"

export const Route = createFileRoute("/projects/$projectId/setup/providers")({
  component: ProvidersSetup,
})

function ProvidersSetup() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])

  const [guildId, setGuildId] = useState("")

  useEffect(() => {
    if (!config) return
    setGuildId(config.fleet.guildId || "")
  }, [bots, config])

  const missingDiscordTokenSecret = useMemo(() => {
    if (!config) return [] as string[]
    const botConfigs = (config.fleet?.bots || {}) as Record<string, any>
    return bots.filter((botId) => !String(botConfigs?.[botId]?.profile?.discordTokenSecret || "").trim())
  }, [bots, config])

  const fixDiscordTokenSecrets = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")
      if (missingDiscordTokenSecret.length === 0) return { ok: true as const }

      const next = structuredClone(config) as any
      next.fleet = next.fleet || {}
      next.fleet.bots = next.fleet.bots || {}
      for (const botId of missingDiscordTokenSecret) {
        const existing = next.fleet.bots[botId] || {}
        next.fleet.bots[botId] = {
          ...existing,
          profile: {
            ...(existing.profile || {}),
            discordTokenSecret: `discord_token_${botId}`,
          },
        }
      }

      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: "Fix discord token secret names" },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Updated discord token secret names")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Validation failed")
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")

      const nextBots: Record<string, any> = { ...(config.fleet.bots as any) }
      const next = {
        ...config,
        fleet: {
          ...config.fleet,
          guildId: guildId.trim(),
          bots: nextBots,
        },
      }

      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: "Update providers" },
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
      <h1 className="text-2xl font-black tracking-tight">Providers</h1>
      <p className="text-muted-foreground">
        Configure provider integrations (Discord v1).
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
            <div className="font-medium">Discord</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp htmlFor="guild" help={setupFieldHelp.providers.guildId}>
                  Guild ID
                </LabelWithHelp>
                <Input id="guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} />
                <div className="text-xs text-muted-foreground">
                  Stored as <code>fleet.guildId</code>.
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-sm font-medium">
                <span>Per-bot Discord token</span>
                <HelpTooltip title="discordTokenSecret" side="top">
                  {setupFieldHelp.providers.discordTokenSecret}
                </HelpTooltip>
              </div>
              <div className="text-xs text-muted-foreground">
                Tokens are stored as encrypted host secrets. Secret names are auto-managed as <code>discord_token_&lt;bot&gt;</code>.
              </div>
              {missingDiscordTokenSecret.length > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
                  <div className="font-medium">Missing discord token secret names</div>
                  <div className="text-xs text-muted-foreground">
                    These bots are missing <code>profile.discordTokenSecret</code>: <code>{missingDiscordTokenSecret.join(", ")}</code>
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={fixDiscordTokenSecrets.isPending}
                      onClick={() => fixDiscordTokenSecrets.mutate()}
                    >
                      Set defaults
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                {bots.length === 0 ? (
                  <div className="text-muted-foreground">No bots.</div>
                ) : (
                  bots.map((botId) => (
                    <div key={botId} className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{botId}</div>
                        <div className="text-xs text-muted-foreground">
                          secret <code>discord_token_{botId}</code>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">managed</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              Save providers
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
