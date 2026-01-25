import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { PlusIcon } from "@heroicons/react/24/outline"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { useProjectBySlug } from "~/lib/project-data"
import { addHost, getClawdletsConfig } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/hosts/")({
  component: HostsOverview,
})

function HostsOverview() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId),
  })

  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])
  const enabledHosts = useMemo(
    () => hosts.filter((h) => Boolean((config?.hosts as any)?.[h]?.enable)).length,
    [config, hosts],
  )
  const [newHostOpen, setNewHostOpen] = useState(false)
  const [newHost, setNewHost] = useState("")
  const addHostMutation = useMutation({
    mutationFn: async () => {
      const trimmed = newHost.trim()
      if (!trimmed) throw new Error("Host name required")
      if (hosts.includes(trimmed)) return { ok: true as const }
      return await addHost({ data: { projectId: projectId as Id<"projects">, host: trimmed } })
    },
    onSuccess: () => {
      toast.success("Host added")
      setNewHost("")
      setNewHostOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="space-y-6">
      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight">Hosts Overview</h1>
              <p className="text-muted-foreground">
                Fleet host summary, status, and defaults.
              </p>
            </div>
            <Dialog open={newHostOpen} onOpenChange={setNewHostOpen}>
              <Button size="sm" onClick={() => setNewHostOpen(true)}>
                <PlusIcon className="size-4" />
                New Host
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New host</DialogTitle>
                  <DialogDescription>
                    Add a host entry to your fleet config.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="new-host-name">Host name</Label>
                  <Input
                    id="new-host-name"
                    placeholder="clawdlets-prod-01"
                    value={newHost}
                    onChange={(e) => setNewHost(e.target.value)}
                  />
                  <div className="text-xs text-muted-foreground">
                    Uses the same naming rules as config host IDs.
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setNewHostOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={addHostMutation.isPending || !newHost.trim()}
                    onClick={() => addHostMutation.mutate()}
                  >
                    Add host
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Default host</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {config.defaultHost || "—"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Hosts</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {hosts.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Enabled</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {enabledHosts}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3">
            {hosts.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  No hosts configured yet.
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="grid grid-cols-12 gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
                  <div className="col-span-5">Name</div>
                  <div className="col-span-4">Public/Target</div>
                  <div className="col-span-2">Location</div>
                  <div className="col-span-1 text-right">Status</div>
                </div>
                <div className="divide-y">
                  {hosts.map((host) => {
                    const hostCfg = (config?.hosts as any)?.[host] || {}
                    const enabled = hostCfg?.enable !== false
                    const location = hostCfg?.hetzner?.location || "—"
                    const target = hostCfg?.targetHost || "—"
                    return (
                      <Link
                        key={host}
                      to="/$projectSlug/hosts/$host"
                      params={{ projectSlug, host }}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="col-span-5 flex items-center gap-2 min-w-0">
                          <span className={enabled ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-muted-foreground/40"} />
                          <div className="font-medium truncate">{host}</div>
                          {config.defaultHost === host ? (
                            <Badge variant="secondary" className="shrink-0">default</Badge>
                          ) : null}
                        </div>
                        <div className="col-span-4 text-sm text-muted-foreground truncate">
                          {target}
                        </div>
                        <div className="col-span-2 text-sm text-muted-foreground truncate">
                          {location}
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Badge variant={enabled ? "secondary" : "outline"}>
                            {enabled ? "enabled" : "disabled"}
                          </Badge>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
