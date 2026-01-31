import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/$botId/overview")({
  component: AgentOverview,
})

function AgentOverview() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      Overview coming soon. This is where health, status, and entry points will live.
    </div>
  )
}
