import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { listPinnedChannels } from "@clawdlets/core/lib/channel-registry"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"
import { Switch } from "~/components/ui/switch"
import { applyBotCapabilityPreset, previewBotCapabilityPreset } from "~/sdk/bots"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function listEnabledChannels(clawdbot: unknown): string[] {
  const cfg = isPlainObject(clawdbot) ? clawdbot : null
  const channels = cfg ? cfg["channels"] : undefined
  if (!isPlainObject(channels)) return []
  return Object.keys(channels)
    .filter((k) => {
      const entry = channels[k]
      if (!isPlainObject(entry)) return true
      return entry["enabled"] !== false
    })
    .sort()
}

export function BotCapabilities(props: {
  projectId: string
  botId: string
  host: string
  clawdbot: unknown
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const channels = useMemo(() => listPinnedChannels(), [])
  const enabledChannels = useMemo(() => listEnabledChannels(props.clawdbot), [props.clawdbot])

  const [selected, setSelected] = useState("")
  const [useLiveSchema, setUseLiveSchema] = useState(false)

  const preview = useMutation({
    mutationFn: async (presetId: string) =>
      await previewBotCapabilityPreset({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          kind: "channel",
          presetId,
        },
      }),
  })

  useEffect(() => {
    if (!selected) return
    preview.mutate(selected)
  }, [preview, selected])

  useEffect(() => {
    if (selected) return
    preview.reset()
  }, [preview, selected])

  const applyPreset = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("missing capability")
      return await applyBotCapabilityPreset({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          host: props.host,
          kind: "channel",
          presetId: selected,
          schemaMode: useLiveSchema ? "live" : "pinned",
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("Failed to apply capability")
        return
      }
      toast.success("Capability applied")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
      setSelected("")
      setUseLiveSchema(false)
    },
    onError: (err) => toast.error(String(err)),
  })

  const previewIssues = preview.data && preview.data.ok ? preview.data.issues : []
  const previewDiff = preview.data && preview.data.ok ? preview.data.diff : []
  const previewWarnings = preview.data && preview.data.ok ? preview.data.warnings : []
  const previewEnv = preview.data && preview.data.ok ? preview.data.requiredEnv : []
  const hasIssues = previewIssues.length > 0
  const canUseLive = Boolean(props.canEdit && props.host.trim())

  return (
    <div className="space-y-4">
      <div>
        <div className="font-medium">Capabilities</div>
        <div className="text-xs text-muted-foreground">
          Add channels and other capabilities with validated presets.
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Add capability</div>
            <Select value={selected || null} onValueChange={(value) => setSelected(value ?? "")}>
              <SelectTrigger className="min-w-[220px] w-full">
                <SelectValue placeholder="Select a channel…" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    <span className="flex items-center gap-2">
                      {channel.name}
                      {enabledChannels.includes(channel.id) ? (
                        <Badge variant="secondary">enabled</Badge>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Validate with live schema</span>
            <Switch
              size="sm"
              checked={useLiveSchema}
              disabled={!canUseLive}
              onCheckedChange={(checked) => setUseLiveSchema(Boolean(checked))}
            />
          </div>
        </div>

        {!canUseLive ? (
          <div className="text-xs text-muted-foreground">
            Live schema validation requires admin access and a reachable host (set <code>defaultHost</code>).
          </div>
        ) : null}
        {!props.canEdit ? (
          <div className="text-xs text-muted-foreground">Read-only access: you can preview capabilities but cannot apply.</div>
        ) : null}

        {preview.data && !preview.data.ok ? (
          <div className="text-xs text-destructive">
            {preview.data.issues?.[0]?.message || "Preview failed"}
          </div>
        ) : null}
        {preview.isPending ? (
          <div className="text-xs text-muted-foreground">Previewing changes…</div>
        ) : null}

        {previewWarnings.length > 0 ? (
          <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground space-y-1">
            {previewWarnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        ) : null}

        {previewEnv.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            Required env: {previewEnv.join(", ")}
          </div>
        ) : null}

        {previewDiff.length > 0 ? (
          <div className="rounded-md border bg-background/60 p-2">
            <div className="text-xs font-medium">Preview diff</div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {previewDiff.slice(0, 12).map((entry) => (
                <li key={`${entry.path}-${entry.change}`} className="flex items-center gap-2">
                  <code className="text-[11px]">{entry.change === "added" ? "+" : entry.change === "removed" ? "-" : "~"}</code>
                  <code>{entry.path}</code>
                </li>
              ))}
              {previewDiff.length > 12 ? (
                <li className="text-[11px] text-muted-foreground">…{previewDiff.length - 12} more changes</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {previewIssues.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <div className="text-xs font-medium text-destructive">Schema issues</div>
            <ul className="mt-2 space-y-1 text-xs text-destructive">
              {previewIssues.slice(0, 6).map((issue, idx) => (
                <li key={`${issue.path?.join(".") || "root"}-${idx}`}>
                  <code>{(issue.path || []).join(".") || "(root)"}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!props.canEdit || !selected || applyPreset.isPending || preview.isPending || hasIssues}
            onClick={() => applyPreset.mutate()}
          >
            Apply
          </Button>
          {hasIssues ? (
            <span className="text-xs text-muted-foreground">Fix schema issues before applying.</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
