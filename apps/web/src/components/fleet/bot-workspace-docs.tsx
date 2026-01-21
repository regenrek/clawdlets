import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { listWorkspaceDocs, resetWorkspaceDocOverride } from "~/sdk/workspace-docs"
import { WorkspaceDocDialog } from "./workspace-doc-dialog"

type WorkspaceDocListItem = {
  name: string
  hasDefault: boolean
  hasOverride: boolean
  effective: "default" | "override" | "missing"
}

function badgeFor(effective: WorkspaceDocListItem["effective"]) {
  if (effective === "override") return { label: "Override", variant: "secondary" as const }
  if (effective === "default") return { label: "Default", variant: "outline" as const }
  return { label: "Missing", variant: "destructive" as const }
}

export function BotWorkspaceDocs(props: { projectId: string; botId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const docs = useQuery({
    queryKey: ["workspaceDocs", props.projectId, props.botId],
    queryFn: async () =>
      await listWorkspaceDocs({
        data: { projectId: props.projectId as Id<"projects">, botId: props.botId },
      }),
  })

  const items = useMemo(
    () => ((docs.data?.docs || []) as WorkspaceDocListItem[]).filter((d) => d.name.endsWith(".md")),
    [docs.data?.docs],
  )

  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const openDocMeta = useMemo(() => items.find((d) => d.name === openDoc) || null, [items, openDoc])

  const reset = useMutation({
    mutationFn: async (name: string) =>
      await resetWorkspaceDocOverride({
        data: { projectId: props.projectId as Id<"projects">, botId: props.botId, name },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Reset to default")
        void queryClient.invalidateQueries({ queryKey: ["workspaceDocs", props.projectId, props.botId] })
      } else toast.error(res.message)
    },
  })

  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">Workspace docs</div>
        <div className="text-xs text-muted-foreground">
          Defaults live in <code>fleet/workspaces/common/</code>. Overrides live in{" "}
          <code>fleet/workspaces/bots/{props.botId}/</code>.
        </div>
      </div>

      {docs.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : docs.error ? (
        <div className="text-sm text-destructive">{String(docs.error)}</div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground">No editable workspace docs found.</div>
      ) : (
        <div className="grid gap-2">
          {items.map((d) => {
            const b = badgeFor(d.effective)
            return (
              <div key={d.name} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate">{d.name}</div>
                    <Badge variant={b.variant}>{b.label}</Badge>
                  </div>
                  {!d.hasDefault ? (
                    <div className="text-xs text-destructive">Missing default in common workspace.</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.hasOverride ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!props.canEdit || reset.isPending}
                      onClick={() => reset.mutate(d.name)}
                    >
                      Use default
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => setOpenDoc(d.name)}>
                    Edit
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <WorkspaceDocDialog
        open={Boolean(openDoc)}
        onOpenChange={(open) => setOpenDoc(open ? openDoc : null)}
        projectId={props.projectId}
        botId={props.botId}
        docName={openDoc}
        canEdit={props.canEdit}
        hasOverride={Boolean(openDocMeta?.hasOverride)}
      />
    </div>
  )
}

