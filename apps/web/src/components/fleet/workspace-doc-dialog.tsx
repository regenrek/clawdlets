import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Textarea } from "~/components/ui/textarea"
import { readWorkspaceDoc, resetWorkspaceDocOverride, writeWorkspaceDoc } from "~/sdk/workspace-docs"

export function WorkspaceDocDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  botId: string
  docName: string | null
  canEdit: boolean
  hasOverride: boolean
}) {
  const queryClient = useQueryClient()

  const enabled = props.open && Boolean(props.docName)
  const docName = props.docName || ""

  const common = useQuery({
    queryKey: ["workspaceDoc", props.projectId, "common", docName],
    enabled,
    queryFn: async () =>
      await readWorkspaceDoc({
        data: {
          projectId: props.projectId as Id<"projects">,
          scope: "common",
          name: docName,
        },
      }),
  })

  const override = useQuery({
    queryKey: ["workspaceDoc", props.projectId, props.botId, "bot", docName],
    enabled,
    queryFn: async () =>
      await readWorkspaceDoc({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          scope: "bot",
          name: docName,
        },
      }),
  })

  const effective = useMemo(() => {
    if (override.data?.exists) return override.data
    if (common.data?.exists) return common.data
    return null
  }, [common.data, override.data])

  const [text, setText] = useState("")
  useEffect(() => {
    if (!enabled) return
    if (!props.docName) return
    const initial = override.data?.exists
      ? override.data.content
      : common.data?.exists
        ? common.data.content
        : ""
    setText(initial)
  }, [enabled, props.docName, override.data?.content, override.data?.exists, common.data?.content, common.data?.exists])

  const save = useMutation({
    mutationFn: async () =>
      await writeWorkspaceDoc({
        data: {
          projectId: props.projectId as Id<"projects">,
          scope: "bot",
          botId: props.botId,
          name: docName,
          content: text,
          expectedSha256: override.data?.exists ? override.data.sha256 : "",
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved workspace doc")
        void queryClient.invalidateQueries({ queryKey: ["workspaceDocs", props.projectId, props.botId] })
        props.onOpenChange(false)
      } else {
        toast.error(res.message)
      }
    },
  })

  const reset = useMutation({
    mutationFn: async () =>
      await resetWorkspaceDocOverride({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          name: docName,
          expectedSha256: override.data?.exists ? override.data.sha256 : "",
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Reset to default")
        void queryClient.invalidateQueries({ queryKey: ["workspaceDocs", props.projectId, props.botId] })
        props.onOpenChange(false)
      } else {
        toast.error(res.message)
      }
    },
  })

  const busy = common.isPending || override.isPending
  const title = props.docName ? `${props.botId} · ${props.docName}` : "Workspace doc"
  const pathLabel = override.data?.exists
    ? override.data.pathRel
    : props.docName
      ? `fleet/workspaces/bots/${props.botId}/${props.docName}`
      : ""

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {pathLabel ? (
              <>
                Editing <code>{pathLabel}</code>. Anything under <code>fleet/workspaces/**</code> is treated as public (no secrets).
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : common.error || override.error ? (
          <div className="text-sm text-destructive">{String(common.error || override.error)}</div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={18}
              spellCheck={false}
              className="font-mono text-xs"
              disabled={!props.canEdit}
              aria-label={`workspace doc ${props.docName || ""}`}
            />
            <div className="text-xs text-muted-foreground">
              Effective source:{" "}
              <code>{override.data?.exists ? "override" : common.data?.exists ? "default" : "missing"}</code>
              {effective?.sha256 ? (
                <>
                  {" "}
                  · sha256 <code>{effective.sha256.slice(0, 10)}</code>
                </>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          {props.hasOverride ? (
            <Button
              type="button"
              variant="outline"
              disabled={!props.canEdit || reset.isPending}
              onClick={() => reset.mutate()}
            >
              Use default
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!props.canEdit || save.isPending || !props.docName}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

