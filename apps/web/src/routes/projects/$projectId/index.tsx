import { createFileRoute, redirect } from "@tanstack/react-router"
export const Route = createFileRoute("/projects/$projectId/")({
  beforeLoad: ({ params }) => {
    if (params.projectId === "new") {
      throw redirect({ to: "/projects/new" })
    }
    if (params.projectId === "import") {
      throw redirect({ to: "/projects/import" })
    }
    throw redirect({ to: "/projects/$projectId/dashboard", params: { projectId: params.projectId } })
  },
  component: () => null,
})
