import { createFileRoute, Link } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"

export const Route = createFileRoute("/$projectSlug/runs/$runId")({
  component: RunDetailPage,
})

function RunDetailPage() {
  const { projectSlug, runId } = Route.useParams()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Run</h1>
          <p className="text-muted-foreground">Realtime logs and status.</p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <Link
              to="/$projectSlug/runs"
              params={{ projectSlug }}
            />
          }
        >
          Back
        </Button>
      </div>

      <RunLogTail runId={runId as Id<"runs">} />
    </div>
  )
}
