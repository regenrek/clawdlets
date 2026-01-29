import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import type { ClawdbotSchemaArtifact } from "@clawdlets/core/lib/clawdbot-schema"
import { getPinnedClawdbotSchema } from "@clawdlets/core/lib/clawdbot-schema"
import type { lintClawdbotSecurityConfig } from "@clawdlets/core/lib/clawdbot-security-lint"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { Badge } from "~/components/ui/badge"
import { MonacoJsonEditor, type JsonEditorDiagnostic } from "~/components/editor/monaco-json-editor"
import { hardenBotClawdbotConfig, setBotClawdbotConfig } from "~/sdk/bots"
import { getClawdbotSchemaLive, getClawdbotSchemaStatus, type ClawdbotSchemaLiveResult } from "~/sdk/clawdbot-schema"
import { createClawdbotParseScheduler, parseClawdbotConfigText } from "~/lib/clawdbot-parse"

export function shouldDisableSave(params: {
  canEdit: boolean
  saving: boolean
  parsedOk: boolean
  hasSchemaErrors: boolean
}): boolean {
  return !params.canEdit || params.saving || !params.parsedOk || params.hasSchemaErrors
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
  const [parsed, setParsed] = useState(() => parseClawdbotConfigText(initialText))
  const [serverIssues, setServerIssues] = useState<null | Array<{ path: string; message: string }>>(null)
  const [schemaIssues, setSchemaIssues] = useState<JsonEditorDiagnostic[]>([])
  const [securityReport, setSecurityReport] = useState<ReturnType<typeof lintClawdbotSecurityConfig> | null>(null)
  const pinnedSchema = useMemo(() => getPinnedClawdbotSchema(), [])
  const [schemaMode, setSchemaMode] = useState<"pinned" | "live">("pinned")
  const [liveSchema, setLiveSchema] = useState<ClawdbotSchemaArtifact | null>(null)
  const [schemaError, setSchemaError] = useState("")
  const parseRunnerRef = useRef<ReturnType<typeof createClawdbotParseScheduler> | null>(null)
  const textRef = useRef(text)
  const botIdRef = useRef(props.botId)

  const schemaStatus = useQuery({
    queryKey: ["clawdbotSchemaStatus", props.projectId],
    queryFn: async () =>
      await getClawdbotSchemaStatus({
        data: { projectId: props.projectId as Id<"projects"> },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    setText(initialText)
    setParsed(parseClawdbotConfigText(initialText))
    setServerIssues(null)
    setSchemaIssues([])
    setSecurityReport(null)
    setSchemaMode("pinned")
    setLiveSchema(null)
    setSchemaError("")
  }, [initialText, props.botId])

  useEffect(() => {
    textRef.current = text
    botIdRef.current = props.botId
  }, [text, props.botId])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!parseRunnerRef.current) {
      parseRunnerRef.current = createClawdbotParseScheduler({
        getText: () => textRef.current,
        getBotId: () => botIdRef.current,
        onParsed: setParsed,
        onSecurity: setSecurityReport,
        delayMs: 400,
        timeoutMs: 1500,
      })
    }
    parseRunnerRef.current.schedule()
    return () => parseRunnerRef.current?.cancel()
  }, [text, props.botId])

  const save = useMutation({
    mutationFn: async () => {
      setServerIssues(null)
      const parsedNow = parseClawdbotConfigText(text)
      if (!parsedNow.ok) throw new Error(parsedNow.message)
      return await setBotClawdbotConfig({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          clawdbot: parsedNow.value,
          schemaMode,
          host: props.host,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved clawdbot config")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
      } else {
        setServerIssues(
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
      setServerIssues(null)
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
      setServerIssues(
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
  const hasHost = Boolean(props.host.trim())
  const canUseLive = Boolean(props.canEdit && hasHost)
  const activeSchema = schemaMode === "live" && liveSchema ? liveSchema : pinnedSchema
  const schemaDiagnostics = schemaIssues
  const hasSchemaErrors = schemaDiagnostics.some((issue) => issue.severity === "error")
  const pinnedNixClawdbotRev = schemaStatus.data && schemaStatus.data.ok ? schemaStatus.data.pinned?.clawdbotRev : null
  const upstreamClawdbotRev = schemaStatus.data && schemaStatus.data.ok ? schemaStatus.data.upstream?.clawdbotRev : null
  const pinnedSchemaRev = pinnedSchema?.clawdbotRev || ""
  const pinnedVsNixClawdbotMismatch = Boolean(pinnedNixClawdbotRev && pinnedSchemaRev && pinnedNixClawdbotRev !== pinnedSchemaRev)
  const pinnedVsUpstreamMismatch = Boolean(upstreamClawdbotRev && pinnedSchemaRev && upstreamClawdbotRev !== pinnedSchemaRev)

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
          <Button
            type="button"
            disabled={shouldDisableSave({
              canEdit: props.canEdit,
              saving: save.isPending,
              parsedOk: parsed.ok,
              hasSchemaErrors,
            })}
            onClick={() => save.mutate()}
          >
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
            {!props.canEdit ? (
              <>Live schema requires admin access.</>
            ) : (
              <>
                Live schema requires a reachable host (set <code>defaultHost</code> in fleet config).
              </>
            )}
          </div>
        ) : null}
        {hasSchemaMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema version differs from live. Pinned v{pinnedVersion} · Live v{liveVersion}
          </div>
        ) : null}
        {pinnedVsNixClawdbotMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema rev differs from nix-clawdbot pinned rev. Schema {pinnedSchemaRev.slice(0, 12)}… ·
            nix-clawdbot {pinnedNixClawdbotRev?.slice(0, 12)}…
          </div>
        ) : null}
        {pinnedVsUpstreamMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema rev behind upstream nix-clawdbot. Schema {pinnedSchemaRev.slice(0, 12)}… · upstream{" "}
            {upstreamClawdbotRev?.slice(0, 12)}…
          </div>
        ) : null}
        {schemaStatus.data && schemaStatus.data.ok && schemaStatus.data.warnings && schemaStatus.data.warnings.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            {schemaStatus.data.warnings.slice(0, 2).map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        ) : null}
        {schemaStatus.data && !schemaStatus.data.ok ? (
          <div className="text-xs text-destructive">{schemaStatus.data.message}</div>
        ) : null}
        {schemaError ? <div className="text-xs text-destructive">{schemaError}</div> : null}
      </div>

      <div className="rounded-md border bg-background/50 p-2">
        <div className="h-[360px]">
          <MonacoJsonEditor
            value={text}
            onChange={setText}
            schema={activeSchema.schema}
            schemaId={`${schemaMode}-${activeSchema.version}-${activeSchema.clawdbotRev}`}
            readOnly={!props.canEdit}
            onDiagnostics={setSchemaIssues}
          />
        </div>
      </div>

      {!parsed.ok ? <div className="text-sm text-destructive">{parsed.message}</div> : null}

      {schemaDiagnostics.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Schema issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {schemaDiagnostics.map((i, idx) => (
              <li key={`${idx}-${i.line}-${i.column}`}>
                <code>
                  {i.line}:{i.column}
                </code>{" "}
                {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {securityReport ? (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Security audit</div>
            <div className="text-xs text-muted-foreground">
              critical={securityReport.summary.critical} warn={securityReport.summary.warn} info={securityReport.summary.info}
            </div>
          </div>
          {securityReport.findings.length > 0 ? (
            <ul className="space-y-2 text-sm text-muted-foreground">
              {securityReport.findings.map((finding) => (
                <li key={finding.id} className="rounded-md border bg-background/60 p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={finding.severity === "critical" ? "destructive" : finding.severity === "warn" ? "default" : "secondary"}>
                      {finding.severity}
                    </Badge>
                    <span className="font-medium">{finding.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{finding.detail}</div>
                  {finding.remediation ? (
                    <div className="text-xs text-foreground">Recommendation: {finding.remediation}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-muted-foreground">No security findings.</div>
          )}
        </div>
      ) : null}

      {serverIssues && serverIssues.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Save validation issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {serverIssues.map((i, idx) => (
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
