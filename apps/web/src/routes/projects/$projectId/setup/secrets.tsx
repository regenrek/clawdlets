import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
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

export const Route = createFileRoute("/projects/$projectId/setup/secrets")({
  component: SecretsSetup,
})

function SecretsSetup() {
  const { projectId } = Route.useParams()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])

  const [host, setHost] = useState("")
  useEffect(() => {
    if (!config) return
    if (host) return
    setHost(config.defaultHost || hosts[0] || "")
  }, [config, host, hosts])

  const template = useMutation({
    mutationFn: async () =>
      await getSecretsTemplate({ data: { projectId: projectId as Id<"projects">, host } }),
  })

  const [allowPlaceholders, setAllowPlaceholders] = useState(false)
  const [adminPassword, setAdminPassword] = useState("")
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("")
  const [needsTailscaleAuthKey, setNeedsTailscaleAuthKey] = useState(false)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [secretsTemplate, setSecretsTemplate] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!template.data) return
    try {
      const parsed = JSON.parse(template.data.templateJson) as any
      const parsedSecrets = (parsed.secrets || {}) as Record<string, string>

      setNeedsTailscaleAuthKey(Boolean(parsed.tailscaleAuthKey))
      if (!parsed.tailscaleAuthKey) setTailscaleAuthKey("")

      setSecretsTemplate(parsedSecrets)

      setSecrets((prev) => {
        const out: Record<string, string> = {}
        for (const name of Object.keys(parsedSecrets)) out[name] = prev[name] || ""
        return out
      })
    } catch {
      // ignore
    }
  }, [template.data])

  const [initRunId, setInitRunId] = useState<Id<"runs"> | null>(null)
  const initStart = useMutation({
    mutationFn: async () => await secretsInitStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setInitRunId(res.runId)
      void secretsInitExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          allowPlaceholders,
          adminPassword,
          tailscaleAuthKey,
          secrets: Object.fromEntries(
            Object.entries(secrets).map(([k, v]) => [k, String(v || "")]).filter(([, v]) => v.trim()),
          ),
        },
      })
      toast.info("Secrets init started")
    },
  })

  const [verifyRunId, setVerifyRunId] = useState<Id<"runs"> | null>(null)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const verifyStart = useMutation({
    mutationFn: async () => await secretsVerifyStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setVerifyRunId(res.runId)
      void secretsVerifyExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host },
      }).then((r) => setVerifyResult(r))
      toast.info("Secrets verify started")
    },
  })

  const [syncRunId, setSyncRunId] = useState<Id<"runs"> | null>(null)
  const [syncPreview, setSyncPreview] = useState<any>(null)
  const syncPreviewRun = useMutation({
    mutationFn: async () =>
      await secretsSyncPreview({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setSyncPreview(res as any)
    },
  })
  const syncStart = useMutation({
    mutationFn: async () => await secretsSyncStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setSyncRunId(res.runId)
      void secretsSyncExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host },
      })
      toast.info("Secrets sync started")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Secrets</h1>
      <p className="text-muted-foreground">
        Local secrets scaffolds, verification, and sync.
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-3">
            <div className="font-medium">Related setup</div>
            <div className="text-xs text-muted-foreground">
              Deploy creds live in Project Settings. Most secrets are configured via bot clawdbot config + secret wiring.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/setup/settings" params={{ projectId }} />}
              >
                Project Settings
              </Button>
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/setup/bots" params={{ projectId }} />}
              >
                Bots
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp htmlFor="secretsHost" help={setupFieldHelp.secrets.host}>
                  Host
                </LabelWithHelp>
                <NativeSelect id="secretsHost" value={host} onChange={(e) => setHost(e.target.value)}>
                  {hosts.map((h) => (
                    <NativeSelectOption key={h} value={h}>
                      {h}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>Allow placeholders</span>
                    <HelpTooltip title="Allow placeholders" side="top">
                      {setupFieldHelp.secrets.allowPlaceholders}
                    </HelpTooltip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Lets secrets init proceed with &lt;PLACEHOLDER&gt; values (not recommended).
                  </div>
                </div>
                <Switch checked={allowPlaceholders} onCheckedChange={setAllowPlaceholders} />
              </div>
            </div>
          </div>

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
                  <Button type="button" variant="outline" disabled={template.isPending || !host} onClick={() => template.mutate()}>
                    Generate template
                  </Button>
                </div>

                {template.data ? (
                  <div className="space-y-4">
                    {template.data.missingSecretConfig?.length ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <div className="font-medium">Missing secret config</div>
                        <pre className="mt-2 text-xs whitespace-pre-wrap break-words">
                          {JSON.stringify(template.data.missingSecretConfig, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <LabelWithHelp htmlFor="adminPass" help={setupFieldHelp.secrets.adminPassword}>
                          Admin password (optional)
                        </LabelWithHelp>
                        <Input id="adminPass" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                        <div className="text-xs text-muted-foreground">
                          If set, the server will generate a yescrypt hash via Nix mkpasswd. If left blank, the existing secret is kept (or placeholders are used when enabled).
                        </div>
                      </div>
                    </div>

                    {needsTailscaleAuthKey ? (
                      <div className="space-y-2">
                        <LabelWithHelp htmlFor="tskey" help={setupFieldHelp.secrets.tailscaleAuthKey}>
                          Tailscale auth key
                        </LabelWithHelp>
                        <Input id="tskey" value={tailscaleAuthKey} onChange={(e) => setTailscaleAuthKey(e.target.value)} placeholder="tskey-auth-…" />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <LabelWithHelp help={setupFieldHelp.secrets.extraSecret}>
                        Secrets
                      </LabelWithHelp>
                      <div className="text-xs text-muted-foreground">
                        Values are written to encrypted YAML in <code>secrets/hosts/{host}</code>.
                      </div>
                      <div className="grid gap-3">
                        {Object.keys(secrets).length === 0 ? (
                          <div className="text-muted-foreground text-sm">No secrets.</div>
                        ) : (
                          Object.keys(secrets).sort().map((name) => {
                            const placeholder = secretsTemplate[name] || "<REPLACE_WITH_SECRET>"
                            const isMultiline = placeholder === "<REPLACE_WITH_NETRC>" || name.includes("netrc")
                            return (
                            <div key={name} className="grid gap-2 md:grid-cols-[220px_1fr] items-center">
                              <div className="flex items-center gap-1 text-sm font-medium truncate">
                                <span className="truncate">{name}</span>
                                <HelpTooltip title={name} side="top">
                                  {setupFieldHelp.secrets.extraSecret}
                                </HelpTooltip>
                              </div>
                              {isMultiline ? (
                                <Textarea
                                  value={secrets[name] || ""}
                                  onChange={(e) => setSecrets((prev) => ({ ...prev, [name]: e.target.value }))}
                                  aria-label={`secret ${name}`}
                                  placeholder={placeholder}
                                  rows={3}
                                  className="font-mono text-xs"
                                />
                              ) : (
                                <Input
                                  type="password"
                                  value={secrets[name] || ""}
                                  onChange={(e) => setSecrets((prev) => ({ ...prev, [name]: e.target.value }))}
                                  aria-label={`secret ${name}`}
                                  placeholder={placeholder}
                                />
                              )}
                            </div>
                            )
                          })
                        )}
                      </div>
                    </div>

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
                <Button type="button" disabled={verifyStart.isPending || !host} onClick={() => verifyStart.mutate()}>
                  Run verify
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
