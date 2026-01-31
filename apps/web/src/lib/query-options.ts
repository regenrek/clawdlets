import { convexQuery } from "@convex-dev/react-query"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { getDashboardOverview } from "~/sdk/dashboard"
import { getClawdletsConfig } from "~/sdk/config"
import { getDeployCredsStatus } from "~/sdk/deploy-creds"

export const queryKeys = {
  dashboardOverview: ["dashboardOverview"] as const,
  clawdletsConfig: (projectId: Id<"projects"> | null) => ["clawdletsConfig", projectId] as const,
  deployCreds: (projectId: Id<"projects"> | null) => ["deployCreds", projectId] as const,
} as const

export function projectsListQueryOptions() {
  return { ...convexQuery(api.projects.list, {}), staleTime: 10_000 }
}

export function projectGetQueryOptions(projectId: Id<"projects">) {
  return { ...convexQuery(api.projects.get, { projectId }), staleTime: 10_000 }
}

export function currentUserQueryOptions() {
  return { ...convexQuery(api.users.getCurrent, {}), staleTime: 30_000 }
}

export function dashboardOverviewQueryOptions() {
  return {
    queryKey: queryKeys.dashboardOverview,
    queryFn: async () => await getDashboardOverview({ data: {} }),
    staleTime: 10_000,
  }
}

export function clawdletsConfigQueryOptions(projectId: Id<"projects"> | null) {
  return {
    queryKey: queryKeys.clawdletsConfig(projectId),
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  }
}

export function deployCredsQueryOptions(projectId: Id<"projects"> | null) {
  return {
    queryKey: queryKeys.deployCreds(projectId),
    queryFn: async () => await getDeployCredsStatus({ data: { projectId: projectId as Id<"projects"> } }),
  }
}

