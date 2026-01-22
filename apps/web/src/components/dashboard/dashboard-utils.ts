import type * as React from "react"
import { Badge } from "~/components/ui/badge"

export type ProjectStatus = "creating" | "ready" | "error"
export type RunStatus = "running" | "succeeded" | "failed" | "canceled"

export function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function formatShortDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function statusBadgeVariant(status: RunStatus): React.ComponentProps<typeof Badge>["variant"] {
  if (status === "succeeded") return "secondary"
  if (status === "failed") return "destructive"
  return "outline"
}

export function projectStatusBadgeVariant(status: ProjectStatus): React.ComponentProps<typeof Badge>["variant"] {
  if (status === "ready") return "secondary"
  if (status === "error") return "destructive"
  return "outline"
}
