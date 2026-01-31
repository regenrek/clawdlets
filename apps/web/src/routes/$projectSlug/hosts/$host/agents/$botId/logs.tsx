import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/$botId/logs")({
  component: AgentLogs,
})

function AgentLogs() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      Logs placeholder. Hook in run log tail / agent logs here.
    </div>
  )
}
