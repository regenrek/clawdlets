import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { StackedField } from "~/components/ui/stacked-field"
import { slugifyProjectName } from "~/lib/project-routing"
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
  const [baseDir, setBaseDir] = useState("")
  const [host, setHost] = useState("")
  const [templateSpec, setTemplateSpec] = useState("")
  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null)

  const directoryInputRef = useRef<HTMLInputElement>(null)
  const nameSlug = useMemo(() => slugifyProjectName(name || "project"), [name])
  const defaultBaseDir = "~/.clawdlets/projects"
  const defaultHost = nameSlug
  const normalizedBaseDir = (baseDir.trim() || defaultBaseDir).replace(/\/$/, "")
  const effectiveLocalPath = normalizedBaseDir.endsWith(`/${nameSlug}`)
    ? normalizedBaseDir
    : `${normalizedBaseDir}/${nameSlug}`
  const effectiveHost = host.trim() || defaultHost

  useEffect(() => {
    const input = directoryInputRef.current
    if (!input) return
    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
  }, [])

  const plan = useMutation({
    mutationFn: async () =>
      await projectInitPlan({
        data: {
          localPath: effectiveLocalPath,
          host: effectiveHost,
          templateSpec,
        },
      }),
  })

  const start = useMutation({
    mutationFn: async () =>
      await projectCreateStart({
        data: {
          name,
          localPath: effectiveLocalPath,
          host: effectiveHost,
          templateSpec,
          gitInit: true,
        },
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
        <StackedField id="name" label="Project name">
          <Input
            id="name"
            placeholder="my-fleet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </StackedField>

        <Accordion collapsible className="rounded-lg border bg-muted/20">
          <AccordionItem value="advanced" className="px-4">
            <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
              Advanced options
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="space-y-4">
                <StackedField
                  id="path"
                  label="Project directory (optional)"
                  description={
                    <>
                      Default: <code>{defaultBaseDir}/{nameSlug}</code>. Stored locally; Convex saves metadata only.
                    </>
                  }
                  actions={
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => directoryInputRef.current?.click()}
                    >
                      Choose folder
                    </Button>
                  }
                >
                  <InputGroup>
                    <InputGroupInput
                      id="path"
                      placeholder={defaultBaseDir}
                      value={baseDir}
                      onChange={(e) => setBaseDir(e.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        onClick={() => setBaseDir(defaultBaseDir)}
                        type="button"
                      >
                        Use default
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <input
                    ref={directoryInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.currentTarget.value = ""
                      if (!file) return
                      const rel = (file as { webkitRelativePath?: string }).webkitRelativePath || ""
                      const root = rel.split("/")[0]
                      const rawPath = (file as { path?: string }).path
                      if (typeof rawPath === "string" && rel) {
                        const parent = rawPath.slice(0, Math.max(0, rawPath.length - rel.length)).replace(/\/$/, "")
                        const next = root ? `${parent}/${root}` : parent
                        if (next) {
                          setBaseDir(next)
                          return
                        }
                      }
                      if (root) {
                        setBaseDir(`${defaultBaseDir}/${root}`)
                        toast.message("Folder name captured. Adjust the path if needed.")
                        return
                      }
                      toast.message("Folder picker unavailable. Enter a directory path.")
                    }}
                  />
                </StackedField>

                <StackedField
                  id="host"
                  label="Host placeholder"
                  description={
                    <>
                      Defaults to <code>{defaultHost}</code>.
                    </>
                  }
                >
                  <Input
                    id="host"
                    placeholder={defaultHost}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </StackedField>

                <StackedField
                  id="template"
                  label="Template"
                  description={
                    <>
                      Defaults to <code>config/template-source.json</code>. Supports <code>github:</code>, <code>gh:</code>,
                      or <code>file:</code> specs.
                    </>
                  }
                >
                  <Input
                    id="template"
                    placeholder="github:owner/repo/templates/default#<40-hex-sha>"
                    value={templateSpec}
                    onChange={(e) => setTemplateSpec(e.target.value)}
                  />
                </StackedField>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={plan.isPending || !name.trim()}
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
              !effectiveLocalPath.trim() ||
              !effectiveHost.trim()
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
                render={
                  <Link
                    to="/$projectSlug"
                    params={{
                      projectSlug: slugifyProjectName(name || "project"),
                    }}
                  />
                }
              >
                Open project
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/$projectSlug/runs"
                    params={{
                      projectSlug: slugifyProjectName(name || "project"),
                    }}
                  />
                }
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
