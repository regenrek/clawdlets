import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import type { ClawdbotSchemaArtifact } from "@clawdlets/core/lib/clawdbot-schema"
import { getPinnedClawdbotSchema } from "@clawdlets/core/lib/clawdbot-schema"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { hardenBotClawdbotConfig, setBotClawdbotConfig } from "~/sdk/bots"
import { getClawdbotSchemaLive, type ClawdbotSchemaLiveResult } from "~/sdk/clawdbot-schema"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function BotClawdbotEditor(props: {
  projectId: string
  botId: string
  host: string
  initial: unknown
  canEdit: boolean
}) {
  const queryClient = useQueryClient()

  const initialText = useMemo(() => JSON.stringify(props.initial ?? {}, null, 2), [props.initial])
  const [text, setText] = useState(initialText)
  const [issues, setIssues] = useState<null | Array<{ path: string; message: string }>>(null)
  const pinnedSchema = useMemo(() => getPinnedClawdbotSchema(), [])
  const [schemaMode, setSchemaMode] = useState<"pinned" | "live">("pinned")
  const [liveSchema, setLiveSchema] = useState<ClawdbotSchemaArtifact | null>(null)
  const [schemaError, setSchemaError] = useState("")

  useEffect(() => {
    setText(initialText)
    setIssues(null)
    setSchemaMode("pinned")
    setLiveSchema(null)
    setSchemaError("")
  }, [initialText, props.botId])

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text)
      if (!isPlainObject(value)) return { ok: false as const, message: "Must be a JSON object (not array/string/number)." }
      return { ok: true as const, value }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Invalid JSON" }
    }
  }, [text])

  const save = useMutation({
    mutationFn: async () => {
      setIssues(null)
      if (!parsed.ok) throw new Error(parsed.message)
      return await setBotClawdbotConfig({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          clawdbot: parsed.value,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved clawdbot config")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
      } else {
        setIssues(
          (res.issues || []).map((i) => ({
            path: (i.path || []).map(String).join(".") || "(root)",
            message: i.message,
          })),
        )
        toast.error("Validation failed")
      }
    },
  })

  const harden = useMutation({
    mutationFn: async () => {
      setIssues(null)
      return await hardenBotClawdbotConfig({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        const changes = Array.isArray((res as any).changes) ? (res as any).changes : []
        toast.success(changes.length > 0 ? "Applied security defaults" : "Already hardened")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
        return
      }
      setIssues(
        (res.issues || []).map((i: any) => ({
          path: (i.path || []).map(String).join(".") || "(root)",
          message: i.message,
        })),
      )
      toast.error("Hardening failed")
    },
    onError: (err) => toast.error(String(err)),
  })

  const liveSchemaFetch = useMutation<ClawdbotSchemaLiveResult>({
    mutationFn: async () =>
      (await getClawdbotSchemaLive({
        data: {
          projectId: props.projectId as Id<"projects">,
          host: props.host,
          botId: props.botId,
        },
      })) as ClawdbotSchemaLiveResult,
    onSuccess: (res) => {
      if (!res.ok) {
        setSchemaError(res.message || "Failed to fetch live schema")
        setSchemaMode("pinned")
        return
      }
      setLiveSchema(res.schema)
      setSchemaMode("live")
      setSchemaError("")
    },
    onError: (err) => {
      setSchemaError(String(err))
      setSchemaMode("pinned")
    },
  })

  const format = () => {
    try {
      const value = JSON.parse(text)
      setText(`${JSON.stringify(value, null, 2)}\n`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON")
    }
  }

  const pinnedVersion = pinnedSchema?.version || "unknown"
  const liveVersion = liveSchema?.version || "unknown"
  const hasSchemaMismatch = Boolean(liveSchema && pinnedSchema?.version && liveSchema.version !== pinnedSchema.version)
  const canUseLive = Boolean(props.host.trim())

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Clawdbot config (JSON)</div>
          <div className="text-xs text-muted-foreground">
            Stored as <code>fleet.bots.{props.botId}.clawdbot</code>.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={format}>
            Format
          </Button>
          <Button type="button" variant="outline" disabled={!props.canEdit || harden.isPending} onClick={() => harden.mutate()}>
            Harden
          </Button>
          <Button type="button" disabled={!props.canEdit || save.isPending || !parsed.ok} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium">Schema source</div>
            <div className="text-xs text-muted-foreground">
              Pinned v{pinnedVersion}
              {pinnedSchema?.generatedAt ? ` · ${pinnedSchema.generatedAt}` : ""}
              {liveSchema ? ` · Live v${liveVersion}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Use live schema (advanced)</span>
            <Switch
              size="sm"
              checked={schemaMode === "live"}
              disabled={!canUseLive || liveSchemaFetch.isPending}
              onCheckedChange={(checked) => {
                if (!checked) {
                  setSchemaMode("pinned")
                  return
                }
                if (!canUseLive) return
                if (liveSchema) {
                  setSchemaMode("live")
                  return
                }
                liveSchemaFetch.mutate()
              }}
            />
          </div>
        </div>
        {!canUseLive ? (
          <div className="text-xs text-muted-foreground">
            Live schema requires a reachable host (set <code>defaultHost</code> in fleet config).
          </div>
        ) : null}
        {hasSchemaMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema version differs from live. Pinned v{pinnedVersion} · Live v{liveVersion}
          </div>
        ) : null}
        {schemaError ? <div className="text-xs text-destructive">{schemaError}</div> : null}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        spellCheck={false}
        className="font-mono text-xs"
        aria-label={`clawdbot config for ${props.botId}`}
        disabled={!props.canEdit}
      />

      {!parsed.ok ? <div className="text-sm text-destructive">{parsed.message}</div> : null}

      {issues && issues.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Validation issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {issues.map((i, idx) => (
              <li key={`${idx}-${i.path}`}>
                <code>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
