import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents")({
  component: AgentsLayout,
})

function AgentsLayout() {
  return <Outlet />
}
