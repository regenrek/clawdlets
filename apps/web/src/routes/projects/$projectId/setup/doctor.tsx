import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { useHostSelection } from "~/lib/host-selection"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { getClawdletsConfig } from "~/sdk/config"
import { runDoctor } from "~/sdk/operations"

export const Route = createFileRoute("/projects/$projectId/setup/doctor")({
  component: DoctorSetup,
})

function pickFixLink(
  projectId: string,
  check: any,
): { to: string; label: string } | null {
  const label = String(check?.label || "").toLowerCase()
  const scope = String(check?.scope || "")

  const toFleet = () => ({ to: `/projects/${projectId}/setup/fleet`, label: "Open Fleet" })
  const toHosts = () => ({ to: `/projects/${projectId}/hosts/overview`, label: "Open Hosts" })
  const toSettings = () => ({ to: `/projects/${projectId}/hosts/secrets`, label: "Open Secrets" })
  const toSecrets = () => ({ to: `/projects/${projectId}/hosts/secrets`, label: "Open Secrets" })
  const toDeploy = () => ({ to: `/projects/${projectId}/hosts/deploy`, label: "Open Deploy" })
  const toAudit = () => ({ to: `/projects/${projectId}/hosts/audit`, label: "Open Audit" })

  if (label.includes("clawdlets config") || label.includes("fleet config")) return toFleet()
  if (label.includes("fleet policy") || label.includes("fleet bots") || label.includes("services.clawdbotfleet.enable")) return toFleet()
  if (label.includes("host config") || label.includes("targethost") || label.includes("sshexposure") || label.includes("diskdevice")) return toHosts()
  if (label.includes("provisioning") || label.includes("admin cidr") || label.includes("ssh pubkey")) return toHosts()
  if (label.includes("hcloud_token") || label.includes("github_token") || label.includes("sops_age_key_file")) return toSettings()
  if (label.includes("sops") || label.includes("secrets")) return toSecrets()
  if (scope === "server-deploy") return toDeploy()
  if (label.includes("tailscale")) return toAudit()
  return null
}

function DoctorSetup() {
  const { projectId } = Route.useParams()
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])

  const { host } = useHostSelection({
    hosts,
    defaultHost: config?.defaultHost || null,
  })
  const [scope, setScope] = useState<"repo" | "bootstrap" | "server-deploy" | "cattle" | "all">("all")
  const [result, setResult] = useState<null | { runId: Id<"runs">; checks: any[]; ok: boolean }>(null)

  const run = useMutation({
    mutationFn: async () => {
      if (!host) throw new Error("missing host")
      return await runDoctor({
        data: {
          projectId: projectId as Id<"projects">,
          host,
          scope,
        },
      })
    },
    onSuccess: (res) => {
      setResult(res as any)
      toast.success(res.ok ? "Doctor ok" : "Doctor found issues")
    },
  })

  const summary = useMemo(() => {
    const checks = result?.checks || []
    const counts = { ok: 0, warn: 0, missing: 0 }
    for (const c of checks) {
      if (c.status === "ok") counts.ok++
      else if (c.status === "warn") counts.warn++
      else counts.missing++
    }
    return counts
  }, [result])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Doctor</h1>
      <p className="text-muted-foreground">
        Validate repo, config, and deploy readiness.
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp help={setupFieldHelp.doctor.host}>
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
                <LabelWithHelp htmlFor="doctorScope" help={setupFieldHelp.doctor.scope}>
                  Scope
                </LabelWithHelp>
                <NativeSelect id="doctorScope" value={scope} onChange={(e) => setScope(e.target.value as any)}>
                  <NativeSelectOption value="all">all</NativeSelectOption>
                  <NativeSelectOption value="repo">repo</NativeSelectOption>
                  <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
                  <NativeSelectOption value="server-deploy">server-deploy</NativeSelectOption>
                  <NativeSelectOption value="cattle">cattle</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <Button type="button" disabled={run.isPending} onClick={() => run.mutate()}>
              Run doctor
            </Button>
          </div>

          {result ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">ok: {summary.ok}</Badge>
                <Badge variant="secondary">warn: {summary.warn}</Badge>
                <Badge variant="destructive">missing: {summary.missing}</Badge>
              </div>

              <div className="rounded-lg border bg-card p-6 space-y-3">
                <div className="font-medium">Report</div>
                <div className="grid gap-2">
                  {result.checks.map((c: any, idx: number) => {
                    const fix = pickFixLink(projectId, c)
                    return (
                      <div key={`${idx}-${c.label}`} className="flex items-start justify-between gap-3 border-b last:border-b-0 pb-2 last:pb-0">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.scope}
                            {c.detail ? ` · ${c.detail}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {fix ? (
                            <Button
                              size="sm"
                              variant="outline"
                              nativeButton={false}
                              render={<Link to={fix.to} />}
                            >
                              {fix.label}
                            </Button>
                          ) : null}
                          <Badge variant={c.status === "missing" ? "destructive" : "secondary"}>
                            {c.status}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <RunLogTail runId={result.runId} />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
