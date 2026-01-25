import { useEffect, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import type { MissingSecretConfig } from "@clawdlets/core/lib/secrets-plan"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { suggestSecretNameForEnvVar } from "~/lib/secret-name-suggest"
import { configDotSet } from "~/sdk/config"

type MissingEnvVar = Extract<MissingSecretConfig, { kind: "envVar" }>
type WireScope = "bot" | "fleet"
type WireDraft = { scope: WireScope; secretName: string }

type MissingEnvWiringPanelProps = {
  projectId: Id<"projects">
  missingEnvVars: MissingEnvVar[]
  onWired?: () => void
}

function defaultScopeForSources(sources: string[]): WireScope {
  return sources.some((source) => source === "model" || source === "provider") ? "fleet" : "bot"
}

function wireKey(entry: MissingEnvVar): string {
  return `${entry.bot}:${entry.envVar}`
}

function buildDefaultDraft(entry: MissingEnvVar): WireDraft {
  const scope = defaultScopeForSources(entry.sources || [])
  const botHint = scope === "bot" ? entry.bot : undefined
  return { scope, secretName: suggestSecretNameForEnvVar(entry.envVar, botHint) }
}

function wirePath(entry: MissingEnvVar, scope: WireScope): string {
  return scope === "bot"
    ? `fleet.bots.${entry.bot}.profile.secretEnv.${entry.envVar}`
    : `fleet.secretEnv.${entry.envVar}`
}

export function MissingEnvWiringPanel(props: MissingEnvWiringPanelProps) {
  const grouped = useMemo(() => {
    const buckets = new Map<string, MissingEnvVar[]>()
    for (const entry of props.missingEnvVars) {
      if (!buckets.has(entry.bot)) buckets.set(entry.bot, [])
      buckets.get(entry.bot)!.push(entry)
    }
    return Array.from(buckets.entries())
      .map(([bot, entries]) => ({ bot, entries: entries.sort((a, b) => a.envVar.localeCompare(b.envVar)) }))
      .sort((a, b) => a.bot.localeCompare(b.bot))
  }, [props.missingEnvVars])

  const [drafts, setDrafts] = useState<Record<string, WireDraft>>({})

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, WireDraft> = {}
      for (const entry of props.missingEnvVars) {
        const key = wireKey(entry)
        next[key] = prev[key] || buildDefaultDraft(entry)
      }
      return next
    })
  }, [props.missingEnvVars])

  const missingCount = props.missingEnvVars.length
  const canWireAll = props.missingEnvVars.every((entry) => {
    const draft = drafts[wireKey(entry)]
    return Boolean(draft?.secretName.trim())
  })

  const wireOne = useMutation({
    mutationFn: async (params: { entry: MissingEnvVar; draft: WireDraft }) => {
      const secretName = params.draft.secretName.trim()
      if (!secretName) throw new Error("missing secret name")
      const path = wirePath(params.entry, params.draft.scope)
      const res = await configDotSet({
        data: {
          projectId: props.projectId,
          path,
          value: secretName,
          del: false,
        },
      })
      if (!res.ok) throw new Error("Failed to write secret wiring")
      return res
    },
    onSuccess: () => {
      toast.success("Secret wiring saved")
      props.onWired?.()
    },
    onError: (err) => {
      toast.error(String(err))
    },
  })

  const wireAll = useMutation({
    mutationFn: async () => {
      for (const entry of props.missingEnvVars) {
        const draft = drafts[wireKey(entry)]
        const secretName = draft?.secretName.trim() || ""
        if (!secretName) throw new Error(`missing secret name for ${entry.envVar}`)
        const path = wirePath(entry, draft.scope)
        const res = await configDotSet({
          data: {
            projectId: props.projectId,
            path,
            value: secretName,
            del: false,
          },
        })
        if (!res.ok) throw new Error(`failed to wire ${entry.envVar}`)
      }
    },
    onSuccess: () => {
      toast.success("All missing env vars wired")
      props.onWired?.()
    },
    onError: (err) => {
      toast.error(String(err))
    },
  })

  if (missingCount === 0) return null

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Missing secret wiring</div>
          <div className="text-xs text-muted-foreground">
            These env vars are required but not wired to secret names yet. Wire them to show inputs below.
          </div>
        </div>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={!canWireAll || wireAll.isPending}
          onClick={() => wireAll.mutate()}
        >
          Wire all (recommended)
        </Button>
      </div>

      <div className="space-y-4">
        {grouped.map((group) => (
          <div key={group.bot} className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              Bot <code>{group.bot}</code>
            </div>
            <div className="grid gap-3">
              {group.entries.map((entry) => {
                const key = wireKey(entry)
                const draft = drafts[key] || buildDefaultDraft(entry)
                const path = wirePath(entry, draft.scope)
                const sourcesLabel = entry.sources?.length ? entry.sources.join(", ") : "unknown"
                const pathsLabel = entry.paths?.length ? entry.paths.join(", ") : "(none)"
                return (
                  <div key={key} className="rounded-md border bg-white/70 p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{entry.envVar}</span>
                      <span className="text-xs text-muted-foreground">sources</span>
                      <code className="text-xs">{sourcesLabel}</code>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[180px_1fr_1fr_auto] items-center">
                      <NativeSelect
                        value={draft.scope}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [key]: {
                              scope: e.target.value === "fleet" ? "fleet" : "bot",
                              secretName: prev[key]?.secretName || draft.secretName,
                            },
                          }))
                        }
                      >
                        <NativeSelectOption value="bot">bot scope</NativeSelectOption>
                        <NativeSelectOption value="fleet">fleet scope</NativeSelectOption>
                      </NativeSelect>
                      <Input
                        value={draft.secretName}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [key]: { ...draft, secretName: e.target.value },
                          }))
                        }
                        placeholder={draft.secretName}
                      />
                      <div className="text-xs text-muted-foreground">
                        Writes to <code>{path}</code>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!draft.secretName.trim() || wireOne.isPending}
                        onClick={() => wireOne.mutate({ entry, draft })}
                      >
                        Wire
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Paths: {pathsLabel}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
