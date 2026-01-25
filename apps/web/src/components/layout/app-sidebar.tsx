import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import {
  ArrowPathIcon,
  BoltIcon,
  CheckIcon,
  ChevronUpDownIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  RocketLaunchIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline"
import {
  Sidebar,
  SidebarContent,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "~/components/ui/dropdown-menu"
import { Label } from "~/components/ui/label"
import { useProjectBySlug, useProjectsList } from "~/lib/project-data"
import {
  buildHostPath,
  buildHostsPath,
  buildProjectBasePath,
  getInstanceHostFromWindow,
  parseHostName,
  parseProjectSlug,
  slugifyProjectName,
  storeLastProjectSlug,
} from "~/lib/project-routing"
import { cn } from "~/lib/utils"

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
            render={<Link to={item.to} />}
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

type NavItem = {
  to: string
  label: string
  icon?: React.ComponentType<React.ComponentProps<"svg">>
  tooltip?: string
}

function AppSidebar() {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const instanceHost = getInstanceHostFromWindow()
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname)
  const projectsQuery = useProjectsList()
  const projects = projectsQuery.data ?? []
  const activeProject = React.useMemo(
    () =>
      projectSlug
        ? projects.find((project) => slugifyProjectName(project.name) === projectSlug) || null
        : null,
    [projectSlug, projects],
  )
  const { projectId } = useProjectBySlug(projectSlug)
  const [navQuery, setNavQuery] = React.useState("")

  if (!projectSlug) {
    return (
      <Sidebar variant="sidebar" collapsible="icon">
        <SidebarContent />
        <SidebarRail />
      </Sidebar>
    )
  }

  const projectBase = buildProjectBasePath(projectSlug)
  const hostsBase = buildHostsPath(projectSlug)
  const hostBase = activeHost
    ? buildHostPath(projectSlug, activeHost)
    : null

  const primaryNav: NavItem[] = [
    {
      to: hostBase || hostsBase,
      label: hostBase ? "Overview" : "Hosts",
      icon: ServerStackIcon,
      tooltip: hostBase ? "Single host overview." : "Fleet host overview.",
    },
    ...(hostBase
      ? [
          {
            to: `${hostBase}/agents`,
            label: "Agents",
            icon: UserGroupIcon,
          },
          {
            to: `${hostBase}/bootstrap`,
            label: "Bootstrap",
            icon: BoltIcon,
          },
          {
            to: `${hostBase}/deploy`,
            label: "Deploy",
            icon: RocketLaunchIcon,
          },
          {
            to: `${hostBase}/secrets`,
            label: "Secrets",
            icon: KeyIcon,
          },
        ]
      : []),
    {
      to: hostBase ? `${hostBase}/logs` : `${projectBase}/runs`,
      label: "Logs",
      icon: DocumentTextIcon,
    },
    {
      to: `${projectBase}/setup/fleet`,
      label: "Skills",
      icon: SparklesIcon,
    },
  ]

  const opsNav: NavItem[] = hostBase
    ? [
        {
          to: `${hostBase}/audit`,
          label: "Audit",
          icon: ShieldCheckIcon,
        },
        {
          to: `${hostBase}/restart`,
          label: "Restart",
          icon: ArrowPathIcon,
        },
      ]
    : []

  const settingsNav: NavItem[] = hostBase
    ? [
        {
          to: `${hostBase}/settings`,
          label: "Settings",
          icon: Cog6ToothIcon,
        },
      ]
    : []

  const projectNav: NavItem[] = projectId
    ? [
        {
          to: `${projectBase}/api-keys`,
          label: "API Keys",
          icon: KeyIcon,
        },
      ]
    : []

  const normalizedQuery = navQuery.trim().toLowerCase()
  const matches = (item: NavItem) =>
    !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery)
  const filteredPrimary = primaryNav.filter(matches)
  const filteredOps = opsNav.filter(matches)
  const filteredSettings = settingsNav.filter(matches)
  const filteredProject = projectNav.filter(matches)
  const hasMatches =
    filteredPrimary.length || filteredOps.length || filteredSettings.length || filteredProject.length

  const isActivePath = React.useCallback(
    (target: string) =>
      pathname === target || pathname.startsWith(`${target}/`),
    [pathname],
  )

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="hover:bg-muted/60 hover:text-foreground active:bg-muted/70 active:text-foreground data-[state=open]:bg-muted/70 data-[state=open]:text-foreground"
                  >
                    <div className="bg-muted text-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                      <img src="/clawdlets-icon.svg" alt="" aria-hidden="true" className="size-4" />
                    </div>
                    <div className="flex flex-col gap-0.5 leading-none">
                      <span className="font-medium">{activeProject?.name || "Select project"}</span>
                      <span className="text-muted-foreground text-xs">{instanceHost}</span>
                    </div>
                    <ChevronUpDownIcon className="ml-auto size-4" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent align="start">
                {projectsQuery.isPending ? (
                  <DropdownMenuItem disabled>Loading projects...</DropdownMenuItem>
                ) : projects.length ? (
                  projects.map((project) => {
                    const slug = slugifyProjectName(project.name)
                    const isActive = slug === projectSlug
                    return (
                      <DropdownMenuItem
                        key={project._id}
                        onSelect={() => {
                          storeLastProjectSlug(slug)
                          void router.navigate({
                            to: buildProjectBasePath(slug),
                          })
                        }}
                      >
                        <span className="truncate">{project.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground capitalize">
                          {project.status}
                        </span>
                        {isActive ? <CheckIcon className="ml-2 size-4" /> : null}
                      </DropdownMenuItem>
                    )
                  })
                ) : (
                  <DropdownMenuItem disabled>No projects</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    void router.navigate({
                      to: "/projects/new",
                    })
                  }
                >
                  New project
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void router.navigate({
                      to: "/projects",
                    })
                  }
                >
                  View all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <form onSubmit={(event) => event.preventDefault()} className="group-data-[collapsible=icon]:hidden">
          <SidebarGroup className="py-0">
            <SidebarGroupContent className="relative">
              <Label htmlFor="sidebar-search" className="sr-only">
                Search
              </Label>
              <SidebarInput
                id="sidebar-search"
                value={navQuery}
                onChange={(event) => setNavQuery(event.target.value)}
                placeholder="Search navigation..."
                className="pl-8"
              />
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
            </SidebarGroupContent>
          </SidebarGroup>
        </form>
      </SidebarHeader>
      <SidebarContent>
        {normalizedQuery && !hasMatches ? (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            No matches.
          </div>
        ) : null}
        <SidebarGroup>
          <SidebarMenu>
            {filteredPrimary.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                isActive={isActivePath(item.to)}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {filteredOps.length ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarMenu>
                {filteredOps.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={isActivePath(item.to)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
        {filteredSettings.length ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarMenu>
                {filteredSettings.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={isActivePath(item.to)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
      {filteredProject.length ? (
        <SidebarFooter>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarMenu>
              {filteredProject.map((item) => (
                <NavLink
                  key={item.to}
                  item={item}
                  isActive={isActivePath(item.to)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  )
}

export { AppSidebar }
