import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { useProjectBySlug } from "~/lib/project-data"
import { getClawdletsConfig } from "~/sdk/config"
import { serverAuditExecute, serverAuditStart, serverStatusExecute, serverStatusStart } from "~/sdk/server-ops"

export const Route = createFileRoute("/$projectSlug/hosts/$host/audit")({
  component: AuditOperate,
})

function AuditOperate() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId),
  })

  const auditLogsQuery = useInfiniteQuery({
    queryKey: ["auditLogsByProject", projectId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!projectId) throw new Error("missing project")
      const args = {
        projectId: projectId as Id<"projects">,
        paginationOpts: { numItems: 50, cursor: pageParam },
      }
      if (convexQueryClient.serverHttpClient) {
        return await convexQueryClient.serverHttpClient.consistentQuery(api.auditLogs.listByProjectPage, args)
      }
      return await convexQueryClient.convexClient.query(api.auditLogs.listByProjectPage, args)
    },
    getNextPageParam: (lastPage) => (lastPage.isDone ? undefined : lastPage.continueCursor),
    enabled: Boolean(projectId),
    gcTime: 10_000,
  })
  const auditLogs = auditLogsQuery.data?.pages.flatMap((p) => p.page) ?? []

  const config = cfg.data?.config as any

  const [targetHost, setTargetHost] = useState("")

  const [statusRunId, setStatusRunId] = useState<Id<"runs"> | null>(null)
  const statusStart = useMutation({
    mutationFn: async () => await serverStatusStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setStatusRunId(res.runId)
      void serverStatusExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, targetHost },
      })
      toast.info("Fetching server status…")
    },
  })

  const [auditRunId, setAuditRunId] = useState<Id<"runs"> | null>(null)
  const [auditResult, setAuditResult] = useState<any>(null)
  const auditStart = useMutation({
    mutationFn: async () => await serverAuditStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setAuditRunId(res.runId)
      void serverAuditExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, targetHost },
      }).then((r) => setAuditResult(r))
      toast.info("Running server audit…")
    },
  })

  const auditSummary = useMemo(() => {
    const checks = auditResult?.result?.checks || []
    const counts = { ok: 0, warn: 0, missing: 0 }
    for (const c of checks) {
      if (c.status === "ok") counts.ok++
      else if (c.status === "warn") counts.warn++
      else counts.missing++
    }
    return counts
  }, [auditResult])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Audit</h1>
      <p className="text-muted-foreground">
        Security and operational audit checks for this host.
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Host</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {host || "No hosts configured"}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target host override (optional)</Label>
                <Input value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="admin@100.64.0.1" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={statusStart.isPending || !host} onClick={() => statusStart.mutate()}>
                Server status
              </Button>
              <Button type="button" disabled={auditStart.isPending || !host} onClick={() => auditStart.mutate()}>
                Run server audit
              </Button>
              <div className="text-xs text-muted-foreground">
                Uses <code>--ssh-tty=false</code>.
              </div>
            </div>
          </div>

          {auditResult?.result?.checks ? (
            <div className="rounded-lg border bg-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Audit summary</div>
                <Badge variant={auditResult.ok ? "secondary" : "destructive"}>{auditResult.ok ? "ok" : "failed"}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">ok: {auditSummary.ok}</Badge>
                <Badge variant="secondary">warn: {auditSummary.warn}</Badge>
                <Badge variant="destructive">missing: {auditSummary.missing}</Badge>
              </div>
              <Textarea readOnly className="font-mono min-h-[200px]" value={JSON.stringify(auditResult.result, null, 2)} />
            </div>
          ) : null}

          {statusRunId ? <RunLogTail runId={statusRunId} /> : null}
          {auditRunId ? <RunLogTail runId={auditRunId} /> : null}

          <div className="rounded-lg border bg-card p-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">Audit log</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={auditLogsQuery.isFetching}
                onClick={() => void auditLogsQuery.refetch()}
              >
                Refresh
              </Button>
            </div>
            {auditLogsQuery.isPending ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : auditLogsQuery.error ? (
              <div className="text-sm text-destructive">{String(auditLogsQuery.error)}</div>
            ) : (
              <div className="grid gap-2">
                {auditLogs.map((row: any) => (
                  <div key={row._id} className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium truncate">{row.action}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(row.ts).toLocaleString()}
                      </div>
                    </div>
                    {row.target ? (
                      <pre className="mt-1 text-xs whitespace-pre-wrap break-words">
                        {JSON.stringify(row.target, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
                {auditLogsQuery.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={auditLogsQuery.isFetchingNextPage}
                    onClick={() => void auditLogsQuery.fetchNextPage()}
                  >
                    {auditLogsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
