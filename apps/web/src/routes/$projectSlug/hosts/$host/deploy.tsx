import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { useProjectBySlug } from "~/lib/project-data"
import { configDotSet, getClawdletsConfig } from "~/sdk/config"
import { runDoctor } from "~/sdk/operations"
import { serverDeployExecute, serverDeployStart } from "~/sdk/server-ops"
import { getHostPublicIpv4 } from "~/sdk/host-connectivity"

export const Route = createFileRoute("/$projectSlug/hosts/$host/deploy")({
  component: DeployOperate,
})

function DeployOperate() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId),
  })

  const config = cfg.data?.config as any
  const hostCfg = host && config?.hosts ? config.hosts[host] : null

  const [manifestPath, setManifestPath] = useState("")
  useEffect(() => {
    if (!host) return
    if (manifestPath) return
    setManifestPath(`deploy-manifest.${host}.json`)
  }, [host, manifestPath])

  const [rev, setRev] = useState("HEAD")
  const [targetHost, setTargetHost] = useState("")
  useEffect(() => {
    if (!host || !hostCfg) return
    if (targetHost) return
    if (hostCfg.targetHost) setTargetHost(String(hostCfg.targetHost))
  }, [host, hostCfg, targetHost])

  const expectedConfirm = host ? `deploy ${host}` : "deploy <host>"
  const [confirm, setConfirm] = useState("")

  const [doctor, setDoctor] = useState<null | { ok: boolean; checks: any[]; runId: Id<"runs"> }>(null)
  const doctorRun = useMutation({
    mutationFn: async () =>
      await runDoctor({
        data: { projectId: projectId as Id<"projects">, host, scope: "server-deploy" },
      }),
    onSuccess: (res) => {
      setDoctor(res as any)
      toast.info(res.ok ? "Doctor ok" : "Doctor found issues")
    },
  })

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const start = useMutation({
    mutationFn: async () =>
      await serverDeployStart({
        data: { projectId: projectId as Id<"projects">, host, manifestPath },
      }),
    onSuccess: (res) => {
      setRunId(res.runId)
      void serverDeployExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          manifestPath,
          rev,
          targetHost,
          confirm,
        },
      })
      toast.info("Deploy started")
    },
  })

  const missingTargetHost = !targetHost.trim()
  const canDeploy = Boolean(host && manifestPath.trim() && doctor?.ok && confirm.trim() === expectedConfirm && !missingTargetHost)

  const publicIpv4Query = useQuery({
    queryKey: ["hostPublicIpv4", projectId, host],
    queryFn: async () => await getHostPublicIpv4({ data: { projectId: projectId as Id<"projects">, host } }),
    enabled: Boolean(projectId && host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const publicIpv4 = publicIpv4Query.data?.ok ? publicIpv4Query.data.ipv4 : ""

  const setTargetHostToPublic = useMutation({
    mutationFn: async (ipv4: string) =>
      await configDotSet({
        data: { projectId: projectId as Id<"projects">, path: `hosts.${host}.targetHost`, value: `admin@${ipv4}` },
      }),
    onSuccess: (res) => {
      if (!res.ok) return
      void cfg.refetch()
    },
  })

  const cliCmd = useMemo(() => {
    if (!host || !manifestPath.trim()) return ""
    const parts = ["clawdlets", "server", "deploy", "--host", host, "--manifest", manifestPath.trim()]
    if (rev.trim() && rev.trim() !== "HEAD") parts.push("--rev", rev.trim())
    if (targetHost.trim()) parts.push("--target-host", targetHost.trim())
    return parts.join(" ")
  }, [host, manifestPath, rev, targetHost])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Deploy</h1>
      <p className="text-muted-foreground">
        Deploy manifests to a host with confirmations and run logs.
      </p>

      {projectQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projectQuery.error ? (
        <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
      ) : !projectId ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            {missingTargetHost ? (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
                <AlertTitle>targetHost required</AlertTitle>
                <AlertDescription>
                  Deploys will fail without <code>hosts.{host}.targetHost</code>.
                  {publicIpv4 ? (
                    <span className="ml-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={setTargetHostToPublic.isPending}
                        onClick={() => setTargetHostToPublic.mutate(publicIpv4)}
                      >
                        Use admin@{publicIpv4}
                      </Button>
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Host</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {host || "No hosts configured"}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Manifest path</Label>
                <Input value={manifestPath} onChange={(e) => setManifestPath(e.target.value)} placeholder={`deploy-manifest.${host}.json`} />
                <div className="text-xs text-muted-foreground">
                  Recommended: a signed deploy manifest generated by CI.
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Git rev (optional)</Label>
                <Input value={rev} onChange={(e) => setRev(e.target.value)} placeholder="HEAD" />
              </div>
              <div className="space-y-2">
                <Label>Target host override (optional)</Label>
                <Input value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="admin@100.64.0.1" />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium">Command</div>
              <pre className="mt-2 text-xs whitespace-pre-wrap break-words">{cliCmd}</pre>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={doctorRun.isPending || !host} onClick={() => doctorRun.mutate()}>
                Run preflight doctor
              </Button>
              <Button type="button" disabled={start.isPending || !canDeploy} onClick={() => start.mutate()}>
                Deploy
              </Button>
              {!doctor?.ok ? (
                <div className="text-xs text-muted-foreground">
                  Run doctor gate first.
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Type to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={expectedConfirm} />
              <div className="text-xs text-muted-foreground">
                Expected: <code>{expectedConfirm}</code>
              </div>
            </div>
          </div>

          {doctor ? (
            <div className="rounded-lg border bg-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Doctor gate</div>
                <Badge variant={doctor.ok ? "secondary" : "destructive"}>{doctor.ok ? "ok" : "failed"}</Badge>
              </div>
              <Textarea readOnly className="font-mono min-h-[140px]" value={JSON.stringify(doctor.checks, null, 2)} />
            </div>
          ) : null}

          {runId ? <RunLogTail runId={runId} /> : null}
        </div>
      )}
    </div>
  )
}
