import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import type { MissingSecretConfig } from "@clawdlets/core/lib/secrets-plan"
import { RunLogTail } from "~/components/run-log-tail"
import { SecretsInputs, type SecretsPlan, type SecretStatus } from "~/components/fleet/secrets-inputs"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SecretInput } from "~/components/ui/secret-input"
import { Spinner } from "~/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { getClawdletsConfig } from "~/sdk/config"
import {
  getSecretsTemplate,
  secretsInitExecute,
  secretsInitStart,
  secretsSyncExecute,
  secretsSyncPreview,
  secretsSyncStart,
  secretsVerifyExecute,
  secretsVerifyStart,
} from "~/sdk/secrets"
import { MissingEnvWiringPanel } from "~/components/secrets/missing-env-wiring"

type HostSecretsPanelProps = {
  projectId: Id<"projects">
  host: string
}

export function HostSecretsPanel({ projectId, host }: HostSecretsPanelProps) {
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () => await getClawdletsConfig({ data: { projectId } }),
  })

  const config = cfg.data?.config as any

  const template = useQuery({
    queryKey: ["secretsTemplate", projectId, host],
    queryFn: async () => await getSecretsTemplate({ data: { projectId, host } }),
    enabled: Boolean(host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const hasTemplate = Boolean(template.data)

  const [adminPassword, setAdminPassword] = useState("")
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("")
  const [tailscaleUnlocked, setTailscaleUnlocked] = useState(false)
  const [needsTailscaleAuthKey, setNeedsTailscaleAuthKey] = useState(false)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [secretsTemplate, setSecretsTemplate] = useState<Record<string, string>>({})
  const [secretsPlan, setSecretsPlan] = useState<SecretsPlan | null>(null)

  useEffect(() => {
    if (!template.data) return
    try {
      const parsed = JSON.parse(template.data.templateJson) as any
      const parsedSecrets = (parsed.secrets || {}) as Record<string, string>
      const plan = (template.data as { secretsPlan?: SecretsPlan }).secretsPlan

      setNeedsTailscaleAuthKey(Boolean(parsed.tailscaleAuthKey))
      if (!parsed.tailscaleAuthKey) setTailscaleAuthKey("")

      setSecretsPlan(plan || null)
      setSecretsTemplate(parsedSecrets)

      setSecrets((prev) => {
        const skipNames = new Set(["admin_password_hash", "tailscale_auth_key"])
        const planNames = plan
          ? Array.from(new Set([
            ...((plan.required || []).map((spec) => spec.name)),
            ...((plan.optional || []).map((spec) => spec.name)),
          ])).filter((name) => !skipNames.has(name))
          : Object.keys(parsedSecrets)
        const out: Record<string, string> = {}
        for (const name of planNames) out[name] = prev[name] || ""
        return out
      })
    } catch {
      // ignore
    }
  }, [template.data])

  const allowedSecretNames = useMemo(() => {
    const names = new Set<string>()
    for (const spec of secretsPlan?.required || []) names.add(spec.name)
    for (const spec of secretsPlan?.optional || []) names.add(spec.name)
    return names
  }, [secretsPlan])
  const planMissing = secretsPlan?.missing
    || (template.data as { missingSecretConfig?: unknown[] } | undefined)?.missingSecretConfig
    || []
  const planWarnings = secretsPlan?.warnings || []
  const missingEnvVars = useMemo(() => {
    return (planMissing || []).filter((item) => (item as MissingSecretConfig).kind === "envVar") as Array<
      Extract<MissingSecretConfig, { kind: "envVar" }>
    >
  }, [planMissing])

  const [initRunId, setInitRunId] = useState<Id<"runs"> | null>(null)
  const initStart = useMutation({
    mutationFn: async () => await secretsInitStart({ data: { projectId, host } }),
    onSuccess: (res) => {
      setInitRunId(res.runId)
      const secretsPayload = Object.fromEntries(
        Object.entries(secrets)
          .map(([k, v]) => [k, String(v || "")])
          .filter(([name, value]) => value.trim() && allowedSecretNames.has(name)),
      )
      void secretsInitExecute({
        data: {
          projectId,
          runId: res.runId,
          host,
          allowPlaceholders: false,
          adminPassword,
          tailscaleAuthKey,
          secrets: secretsPayload,
        },
      })
      toast.info("Secrets init started")
    },
  })

  const verifyQuery = useQuery({
    queryKey: ["secretsVerify", projectId, host],
    queryFn: async () => {
      if (!host) throw new Error("missing host")
      const res = await secretsVerifyStart({ data: { projectId, host } })
      const result = await secretsVerifyExecute({
        data: { projectId, runId: res.runId, host },
      })
      return { runId: res.runId, result }
    },
    enabled: Boolean(host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const verifyRunId = verifyQuery.data?.runId ?? null
  const verifyResult = verifyQuery.data?.result ?? null
  const verifyUpdatedAt = verifyQuery.dataUpdatedAt || null

  const [syncRunId, setSyncRunId] = useState<Id<"runs"> | null>(null)
  const [syncPreview, setSyncPreview] = useState<any>(null)
  const syncPreviewRun = useMutation({
    mutationFn: async () =>
      await secretsSyncPreview({ data: { projectId, host } }),
    onSuccess: (res) => {
      setSyncPreview(res as any)
    },
  })
  const syncStart = useMutation({
    mutationFn: async () => await secretsSyncStart({ data: { projectId, host } }),
    onSuccess: (res) => {
      setSyncRunId(res.runId)
      void secretsSyncExecute({
        data: { projectId, runId: res.runId, host },
      })
      toast.info("Secrets sync started")
    },
  })

  useEffect(() => {
    setAdminUnlocked(false)
    setTailscaleUnlocked(false)
  }, [host])

  const verifyResults = useMemo(() => {
    const results = verifyResult?.result?.results
    return Array.isArray(results) ? results : []
  }, [verifyResult])

  const verifySummary = useMemo(() => {
    if (verifyResults.length === 0) return null
    let ok = 0
    let missing = 0
    let warn = 0
    for (const entry of verifyResults) {
      if (entry?.status === "ok") ok += 1
      else if (entry?.status === "missing") missing += 1
      else if (entry?.status === "warn") warn += 1
    }
    return { ok, missing, warn, total: verifyResults.length }
  }, [verifyResults])

  const secretStatusByName = useMemo<Record<string, SecretStatus>>(() => {
    const out: Record<string, SecretStatus> = {}
    for (const entry of verifyResults) {
      if (!entry || typeof entry.secret !== "string") continue
      if (entry.status === "ok" || entry.status === "missing" || entry.status === "warn") {
        out[entry.secret] = { status: entry.status, detail: typeof entry.detail === "string" ? entry.detail : undefined }
      }
    }
    return out
  }, [verifyResults])

  const adminLocked = secretStatusByName["admin_password_hash"]?.status === "ok" && !adminUnlocked
  const tailscaleLocked = secretStatusByName["tailscale_auth_key"]?.status === "ok" && !tailscaleUnlocked
  const lockedPlaceholder = "set (click Remove to edit)"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Host secrets</h1>
        <p className="text-muted-foreground">
          Host-scoped secrets stored under <code>secrets/hosts/&lt;host&gt;</code>.
        </p>
      </div>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <Tabs defaultValue="init">
            <TabsList>
              <TabsTrigger value="init">Init</TabsTrigger>
              <TabsTrigger value="verify">Verify</TabsTrigger>
              <TabsTrigger value="sync">Sync</TabsTrigger>
            </TabsList>

            <TabsContent value="init">
              <div className="rounded-lg border bg-card p-6 space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Secrets init</div>
                    <div className="text-xs text-muted-foreground">
                      Writes encrypted host secrets and extra-files scaffolds. Runs <code>clawdlets secrets init</code>.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={template.isFetching || !host}
                    onClick={() => void template.refetch()}
                  >
                    {hasTemplate ? "Refresh template" : "Generate template"}
                  </Button>
                </div>

                {template.isPending ? (
                  <div className="text-muted-foreground text-sm">Loading template…</div>
                ) : template.error ? (
                  <div className="text-sm text-destructive">{String(template.error)}</div>
                ) : template.data ? (
                  <div className="space-y-4">
                    <div className="text-xs text-muted-foreground">
                      Template auto-loaded. Secrets are not shown; use Verify to check. Refresh if you changed config.
                    </div>
                    {template.dataUpdatedAt ? (
                      <div className="text-xs text-muted-foreground">
                        Last refreshed: <code>{new Date(template.dataUpdatedAt).toLocaleString()}</code>
                      </div>
                    ) : null}
                    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">Stored secrets status</div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={verifyQuery.isFetching || !host}
                            onClick={() => void verifyQuery.refetch()}
                          >
                            {verifyQuery.isFetching ? "Checking…" : "Check stored secrets"}
                          </Button>
                        </div>
                      {verifySummary ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">set {verifySummary.ok}</Badge>
                          {verifySummary.warn ? <Badge variant="outline">optional {verifySummary.warn}</Badge> : null}
                          {verifySummary.missing ? <Badge variant="destructive">missing {verifySummary.missing}</Badge> : null}
                          {verifyUpdatedAt ? (
                            <span className="text-muted-foreground">
                              Last checked: {new Date(verifyUpdatedAt).toLocaleString()}
                            </span>
                          ) : null}
                          {verifyQuery.isFetching ? (
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <Spinner className="size-3" />
                              Checking…
                            </span>
                          ) : null}
                        </div>
                      ) : verifyQuery.isFetching ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Spinner className="size-3" />
                          Checking stored secrets…
                        </div>
                      ) : verifyQuery.error ? (
                        <div className="text-sm text-destructive">{String(verifyQuery.error)}</div>
                      ) : (
                        <div className="text-muted-foreground">
                          Not checked yet. Runs the same check as the Verify tab.
                        </div>
                      )}
                    </div>
                    {planWarnings.length ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm space-y-2">
                        <div className="font-medium">Warnings</div>
                        <div className="space-y-2">
                          {planWarnings.map((warning, idx) => (
                            <div key={`${warning.kind}-${idx}`} className="rounded-md border bg-white/70 p-2">
                              <div className="text-sm font-medium">{warning.message}</div>
                              <div className="text-xs text-muted-foreground">
                                {warning.kind}
                                {warning.bot ? ` · bot ${warning.bot}` : ""}
                                {warning.path ? ` · ${warning.path}` : ""}
                              </div>
                              {warning.suggestion ? (
                                <div className="text-xs text-muted-foreground">
                                  Suggestion: <code>{warning.suggestion}</code>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <MissingEnvWiringPanel
                      projectId={projectId}
                      missingEnvVars={missingEnvVars}
                      onWired={() => void template.refetch()}
                    />

                    {planMissing.length ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <div className="font-medium">Missing secret config (details)</div>
                        <pre className="mt-2 text-xs whitespace-pre-wrap break-words">
                          {JSON.stringify(planMissing, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <LabelWithHelp htmlFor="adminPass" help={setupFieldHelp.secrets.adminPassword}>
                            Admin password (optional)
                          </LabelWithHelp>
                        </div>
                        <SecretInput
                          id="adminPass"
                          value={adminPassword}
                          onValueChange={setAdminPassword}
                          placeholder={adminLocked ? lockedPlaceholder : "Set new admin password"}
                          locked={adminLocked}
                          onUnlock={() => setAdminUnlocked(true)}
                        />
                        <div className="text-xs text-muted-foreground">
                          If set, the server will generate a yescrypt hash via Nix mkpasswd. If left blank, the existing secret is kept (or placeholders are used when enabled).
                        </div>
                      </div>
                    </div>

                    {needsTailscaleAuthKey ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <LabelWithHelp htmlFor="tskey" help={setupFieldHelp.secrets.tailscaleAuthKey}>
                            Tailscale auth key
                          </LabelWithHelp>
                        </div>
                        <SecretInput
                          id="tskey"
                          value={tailscaleAuthKey}
                          onValueChange={setTailscaleAuthKey}
                          placeholder={tailscaleLocked ? lockedPlaceholder : "tskey-auth-…"}
                          locked={tailscaleLocked}
                          onUnlock={() => setTailscaleUnlocked(true)}
                        />
                      </div>
                    ) : null}

                    <SecretsInputs
                      host={host}
                      secrets={secrets}
                      setSecrets={setSecrets}
                      secretsTemplate={secretsTemplate}
                      secretsPlan={secretsPlan}
                      secretStatusByName={secretStatusByName}
                    />

                    <Button type="button" disabled={initStart.isPending || !host} onClick={() => initStart.mutate()}>
                      Run secrets init
                    </Button>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Generate a template to see required tokens for this host.
                  </div>
                )}

                {initRunId ? <RunLogTail runId={initRunId} /> : null}
              </div>
            </TabsContent>

            <TabsContent value="verify">
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <div className="font-medium">Secrets verify</div>
                <div className="text-xs text-muted-foreground">
                  Runs <code>clawdlets secrets verify --json</code> and summarizes missing secrets.
                </div>
                <Button type="button" disabled={verifyQuery.isFetching || !host} onClick={() => void verifyQuery.refetch()}>
                  {verifyQuery.isFetching ? "Checking…" : "Run verify"}
                </Button>
                {verifyResult?.result ? (
                  <Textarea readOnly className="font-mono min-h-[200px]" value={JSON.stringify(verifyResult.result, null, 2)} />
                ) : null}
                {verifyRunId ? <RunLogTail runId={verifyRunId} /> : null}
              </div>
            </TabsContent>

            <TabsContent value="sync">
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <div className="font-medium">Secrets sync</div>
                <div className="text-xs text-muted-foreground">
                  Copies secrets to the server using <code>clawdlets secrets sync</code>. Requires SSH access.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" disabled={syncPreviewRun.isPending || !host} onClick={() => syncPreviewRun.mutate()}>
                    Preview files
                  </Button>
                  <Button type="button" disabled={syncStart.isPending || !host} onClick={() => syncStart.mutate()}>
                    Sync now
                  </Button>
                </div>

                {syncPreview ? (
                  syncPreview.ok ? (
                    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                      <div className="text-sm font-medium">Will sync</div>
                      <div className="text-xs text-muted-foreground">
                        {syncPreview.files?.length ?? 0} file(s) · digest <code>{syncPreview.digest}</code>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap break-words">
                        {String(syncPreview.localDir)}{"\n"}→{"\n"}{String(syncPreview.remoteDir)}{"\n\n"}
                        {(syncPreview.files || []).join("\n")}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-sm text-destructive">
                      Preview failed: {String(syncPreview.message)}
                    </div>
                  )
                ) : null}
                {syncRunId ? <RunLogTail runId={syncRunId} /> : null}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}
