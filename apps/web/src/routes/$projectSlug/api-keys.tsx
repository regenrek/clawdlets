import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/api-keys")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/security/api-keys",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
