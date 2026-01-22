import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { Cog6ToothIcon, ServerStackIcon } from "@heroicons/react/24/outline"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

type NavItem = {
  to: string
  label: string
  icon?: React.ComponentType<React.ComponentProps<"svg">>
  tooltip?: string
  search?: Record<string, unknown>
}

function useActiveProjectId(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const match = pathname.match(/^\/projects\/([^/]+)/)
  const raw = match?.[1] ?? null
  if (!raw) return null
  if (raw === "new" || raw === "import") return null
  return raw
}

function NavLink({
  item,
  isActive,
}: {
  item: NavItem
  isActive: boolean
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={
          item.tooltip
            ? {
                children: (
                  <div className="space-y-0.5">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-background/70">{item.tooltip}</div>
                  </div>
                ),
              }
            : undefined
        }
        render={
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to={item.to} search={item.search} />}
            className={cn(
              "w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
          />
        }
      >
        {item.icon ? <item.icon aria-hidden="true" /> : null}
        <span className="truncate">{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function AppSidebarContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectId = useActiveProjectId()

  const projectBase = projectId ? `/projects/${projectId}` : null
  const projectSettings: NavItem[] = projectBase
    ? [
        {
          to: `${projectBase}/hosts/overview`,
          label: "Hosts",
          icon: ServerStackIcon,
          tooltip: "Host-specific overview, agents, secrets, deploy, and settings.",
          search: {},
        },
        {
          to: `${projectBase}/setup/settings`,
          label: "Project Settings",
          icon: Cog6ToothIcon,
          tooltip: "Project-level credentials and operator settings.",
        },
      ]
    : []

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarContent>
        {projectId ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Project</SidebarGroupLabel>
              <SidebarMenu>
                {projectSettings.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}

function AppSidebar({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <AppSidebarContent />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}

export { AppSidebar }
