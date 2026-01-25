import { Link } from "@tanstack/react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import type { Id } from "../../../convex/_generated/dataModel"
import type { DashboardProjectSummary } from "~/sdk/dashboard"
import { slugifyProjectName } from "~/lib/project-routing"
import { formatShortDate, projectStatusBadgeVariant } from "./dashboard-utils"

export function ProjectsTable(props: {
  projects: DashboardProjectSummary[]
  selectedProjectId: Id<"projects"> | null
  onSelectProjectId: (projectId: Id<"projects">) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Bots</TableHead>
          <TableHead>Hosts</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.projects.map((p) => {
          const selected = props.selectedProjectId === p.projectId
          const bots = p.cfg.error ? "—" : p.cfg.botsTotal.toLocaleString()
          const hosts = p.cfg.error
            ? "—"
            : `${p.cfg.hostsEnabled.toLocaleString()} / ${p.cfg.hostsTotal.toLocaleString()}`
          const projectSlug = slugifyProjectName(p.name)

          return (
            <TableRow
              key={p.projectId}
              data-state={selected ? "selected" : undefined}
              className="cursor-pointer"
              onClick={() => props.onSelectProjectId(p.projectId)}
            >
              <TableCell className="max-w-[420px]">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-muted-foreground text-xs truncate mt-0.5">{p.localPath}</div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={projectStatusBadgeVariant(p.status)}
                    className="capitalize"
                  >
                    {p.status}
                  </Badge>
                  {p.cfg.error ? <Badge variant="destructive">Config</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{bots}</TableCell>
              <TableCell className="tabular-nums">{hosts}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatShortDate(p.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link to="/$projectSlug" params={{ projectSlug }} />}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
