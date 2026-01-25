import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { projectImport } from "~/sdk/projects"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/projects/import")({
  component: ImportProject,
})

function ImportProject() {
  const [name, setName] = useState("")
  const [localPath, setLocalPath] = useState("")

  const importMutation = useMutation({
    mutationFn: async () => await projectImport({ data: { name, localPath } }),
  })

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Import Project</h1>
        <p className="text-muted-foreground mt-1">
          Register an existing clawdlets repo on this machine.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            placeholder="my-existing-fleet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="path">Directory</Label>
          <Input
            id="path"
            placeholder="~/projects/my-existing-fleet"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
          />
          <div className="text-muted-foreground text-xs">
            Must contain <code>fleet/clawdlets.json</code>.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={importMutation.isPending || !name.trim() || !localPath.trim()}
            onClick={() => importMutation.mutate()}
          >
            Import
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to="/projects" />}
          >
            Cancel
          </Button>
        </div>

        {importMutation.data ? (
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            Imported.{" "}
            <Link
              to="/$projectSlug"
              params={{
                projectSlug: slugifyProjectName(name || "project"),
              }}
              className="underline"
            >
              Open project
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
