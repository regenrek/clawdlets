import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/advanced/commands")({
  component: CommandRunner,
})

function CommandRunner() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-black tracking-tight">Command Runner</h1>
      <p className="text-muted-foreground">
        Run guarded clawdlets commands and stream redacted logs.
      </p>
      <div className="text-muted-foreground text-sm">
        Phase 1/4/5: runner primitives + redaction + RBAC.
      </div>
    </div>
  )
}

