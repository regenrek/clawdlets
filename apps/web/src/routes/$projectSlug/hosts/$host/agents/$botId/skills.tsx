import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/$botId/skills")({
  component: AgentSkills,
})

function AgentSkills() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      Skills placeholder. Skills management will land here.
    </div>
  )
}
