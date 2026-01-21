import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  projectCreateExecute,
  projectCreateStart,
  projectInitPlan,
} from "~/sdk/projects"
import type { Id } from "../../../convex/_generated/dataModel"

export const Route = createFileRoute("/projects/new")({
  component: NewProject,
})

function NewProject() {
  const [name, setName] = useState("")
  const [localPath, setLocalPath] = useState("")
  const [host, setHost] = useState("clawdbot-fleet-host")
  const [templateSpec, setTemplateSpec] = useState("")
  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null)

  const plan = useMutation({
    mutationFn: async () =>
      await projectInitPlan({ data: { localPath, host, templateSpec } }),
  })

  const start = useMutation({
    mutationFn: async () =>
      await projectCreateStart({
        data: { name, localPath, host, templateSpec, gitInit: true },
      }),
    onSuccess: (res) => {
      setRunId(res.runId)
      setProjectId(res.projectId)
      void projectCreateExecute({ data: res })
    },
  })

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Create Project</h1>
        <p className="text-muted-foreground mt-1">
          Scaffold a new clawdlets infra repository on this machine.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            placeholder="my-fleet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="path">Directory</Label>
          <Input
            id="path"
            placeholder="~/projects/my-fleet"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
          />
          <div className="text-muted-foreground text-xs">
            Stored locally. Secrets remain on disk; Convex stores metadata only.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="host">Host placeholder</Label>
            <Input
              id="host"
              placeholder="clawdbot-fleet-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template">Template (advanced)</Label>
            <Input
              id="template"
              placeholder="github:owner/repo/templates/default#<40-hex-sha>"
              value={templateSpec}
              onChange={(e) => setTemplateSpec(e.target.value)}
            />
            <div className="text-muted-foreground text-xs">
              Defaults to <code>config/template-source.json</code>. Supports <code>github:</code>, <code>gh:</code>, or{" "}
              <code>file:</code> specs.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={plan.isPending || !localPath.trim()}
            onClick={() => plan.mutate()}
          >
            Preview files
          </Button>
          <Button
            type="button"
            disabled={
              start.isPending ||
              !!runId ||
              !name.trim() ||
              !localPath.trim() ||
              !host.trim()
            }
            onClick={() => start.mutate()}
          >
            Create
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to="/projects" />}
          >
            Cancel
          </Button>
        </div>

        {plan.data ? (
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-sm font-medium">
              {plan.data.plannedFiles.length} files
            </div>
            <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap break-words max-h-48 overflow-auto">
              {plan.data.plannedFiles.slice(0, 200).join("\n")}
              {plan.data.plannedFiles.length > 200
                ? `\n… +${plan.data.plannedFiles.length - 200} more`
                : ""}
            </pre>
          </div>
        ) : null}

        {projectId && runId ? (
          <div className="space-y-3">
            <RunLogTail runId={runId} />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/projects/$projectId" params={{ projectId }} />}
              >
                Open project
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/runs" params={{ projectId }} />}
              >
                Runs
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
