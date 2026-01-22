import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
import { canBootstrapFromDoctorGate } from "~/lib/bootstrap-gate"
import { useHostSelection } from "~/lib/host-selection"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { getClawdletsConfig } from "~/sdk/config"
import { getDeployCredsStatus } from "~/sdk/deploy-creds"
import { bootstrapExecute, bootstrapStart, runDoctor } from "~/sdk/operations"

export const Route = createFileRoute("/projects/$projectId/hosts/bootstrap")({
  component: BootstrapSetup,
})

function BootstrapSetup() {
  const { projectId } = Route.useParams()
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () =>
      await getDeployCredsStatus({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])

  const { host } = useHostSelection({
    hosts,
    defaultHost: config?.defaultHost || null,
  })
  const [mode, setMode] = useState<"nixos-anywhere" | "image">("nixos-anywhere")
  const [force, setForce] = useState(false)
  const [dryRun, setDryRun] = useState(false)

  const [doctor, setDoctor] = useState<null | { ok: boolean; checks: any[]; runId: Id<"runs"> }>(null)

  const doctorRun = useMutation({
    mutationFn: async () =>
      await runDoctor({
        data: { projectId: projectId as Id<"projects">, host, scope: "bootstrap" },
      }),
    onSuccess: (res) => {
      setDoctor(res as any)
      toast.info(res.ok ? "Doctor ok" : "Doctor found issues")
    },
  })

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const start = useMutation({
    mutationFn: async () =>
      await bootstrapStart({ data: { projectId: projectId as Id<"projects">, host, mode } }),
    onSuccess: (res) => {
      setRunId(res.runId)
      void bootstrapExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, mode, force, dryRun },
      })
      toast.info("Bootstrap started")
    },
  })

  const canBootstrap = canBootstrapFromDoctorGate({ host, force, doctor })
  const cliCmd = useMemo(() => {
    if (!host) return ""
    const parts = ["clawdlets", "bootstrap", "--host", host, "--mode", mode]
    if (force) parts.push("--force")
    if (dryRun) parts.push("--dry-run")
    return parts.join(" ")
  }, [dryRun, force, host, mode])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Bootstrap</h1>
          <p className="text-muted-foreground">
            Bootstrap the host with structured progress and logs.
          </p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link to="/projects/$projectId/setup/doctor" params={{ projectId }} />}>
          Open Doctor
        </Button>
      </div>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp help={setupFieldHelp.bootstrap.host}>
                  Host
                </LabelWithHelp>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {host || "No hosts configured"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Change the active host in the header.
                </div>
              </div>
              <div className="space-y-2">
                <LabelWithHelp htmlFor="bootstrapMode" help={setupFieldHelp.bootstrap.mode}>
                  Mode
                </LabelWithHelp>
                <NativeSelect id="bootstrapMode" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                  <NativeSelectOption value="nixos-anywhere">nixos-anywhere</NativeSelectOption>
                  <NativeSelectOption value="image">image</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>Force</span>
                    <HelpTooltip title="Force" side="top">
                      {setupFieldHelp.bootstrap.force}
                    </HelpTooltip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Skips doctor gate in CLI (not recommended).
                  </div>
                </div>
                <Switch checked={force} onCheckedChange={setForce} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>Dry run</span>
                    <HelpTooltip title="Dry run" side="top">
                      {setupFieldHelp.bootstrap.dryRun}
                    </HelpTooltip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Prints commands without executing.
                  </div>
                </div>
                <Switch checked={dryRun} onCheckedChange={setDryRun} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={doctorRun.isPending || !host} onClick={() => doctorRun.mutate()}>
                Run preflight doctor
              </Button>
              <Button type="button" disabled={start.isPending || !canBootstrap} onClick={() => start.mutate()}>
                Bootstrap
              </Button>
              {!canBootstrap && !force ? (
                <div className="text-xs text-muted-foreground">
                  Run doctor first (or enable force).
                </div>
              ) : null}
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium">Command</div>
              <pre className="mt-2 text-xs whitespace-pre-wrap break-words">{cliCmd}</pre>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Deploy credentials</div>
                <div className="text-xs text-muted-foreground">
                  Bootstrap requires <code>HCLOUD_TOKEN</code> and a secure <code>.clawdlets/env</code>.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={creds.isFetching}
                onClick={() => void creds.refetch()}
              >
                Refresh
              </Button>
            </div>
            {creds.isPending ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : creds.error ? (
              <div className="text-sm text-destructive">{String(creds.error)}</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {(creds.data?.keys || []).map((k: any) => (
                  <div key={k.key} className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{k.key}</div>
                      <div className="text-xs text-muted-foreground">
                        {k.status} · {k.source}
                        {k.value ? ` · ${k.value}` : ""}
                      </div>
                    </div>
                    <div className={k.status === "set" ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
                      {k.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {doctor ? (
            <div className="rounded-lg border bg-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Doctor gate</div>
                <Badge variant={doctor.ok ? "secondary" : "destructive"}>{doctor.ok ? "ok" : "failed"}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Scope: bootstrap
              </div>
              <div className="grid gap-2">
                {doctor.checks.map((c: any, idx: number) => (
                  <div key={`${idx}-${c.label}`} className="flex items-start justify-between gap-3 border-b last:border-b-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.status}{c.detail ? ` · ${c.detail}` : ""}
                      </div>
                    </div>
                    <Badge variant={c.status === "missing" ? "destructive" : "secondary"}>{c.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {runId ? <RunLogTail runId={runId} /> : null}
        </div>
      )}
    </div>
  )
}
