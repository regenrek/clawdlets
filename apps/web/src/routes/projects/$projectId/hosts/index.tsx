import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/projects/$projectId/hosts/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectId/hosts/overview",
      params: { projectId: params.projectId },
    })
  },
  component: () => null,
})
