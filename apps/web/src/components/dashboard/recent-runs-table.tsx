import { Link } from "@tanstack/react-router"
import { Badge } from "~/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import { formatShortDateTime, statusBadgeVariant, type RunStatus } from "./dashboard-utils"
import type { Id } from "../../../convex/_generated/dataModel"

export type RunRow = {
  _id: Id<"runs">
  kind: string
  status: RunStatus
  title?: string
  startedAt: number
}

export function RecentRunsTable(props: {
  runs: RunRow[]
  projectSlug: string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.runs.map((r) => (
          <TableRow key={r._id}>
            <TableCell className="max-w-[520px]">
              <Link
                to="/$projectSlug/runs/$runId"
                params={{ projectSlug: props.projectSlug, runId: r._id }}
                className="block hover:underline"
              >
                <div className="font-medium truncate">{r.title || r.kind}</div>
                <div className="text-muted-foreground text-xs truncate mt-0.5">
                  {r.kind}
                </div>
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant={statusBadgeVariant(r.status)} className="capitalize">
                {r.status}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDateTime(r.startedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
