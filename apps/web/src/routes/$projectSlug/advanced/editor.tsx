import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/advanced/editor")({
  component: RawEditor,
})

function RawEditor() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-black tracking-tight">Raw Editor</h1>
      <p className="text-muted-foreground">
        Edit scoped config files with validation and diffs.
      </p>
      <div className="text-muted-foreground text-sm">
        Phase 2/5: safe file editing via control-plane.
      </div>
    </div>
  )
}

