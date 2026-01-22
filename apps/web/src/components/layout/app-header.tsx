import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowDown01Icon,
  GithubIcon,
  MoreHorizontalCircle01Icon,
} from "@hugeicons/core-free-icons"
import { ModeToggle } from "~/components/mode-toggle"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { SidebarTrigger } from "~/components/ui/sidebar"
import { useAuthState } from "~/lib/auth-state"
import { authClient } from "~/lib/auth-client"
import { useHostSelection } from "~/lib/host-selection"
import { cn } from "~/lib/utils"
import { getClawdletsConfig } from "~/sdk/config"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"

type ProjectOption = {
  _id: Id<"projects">
  name: string
  status: string
  updatedAt: number
  lastSeenAt?: number | null
}

type HostOption = {
  name: string
  enabled: boolean
  isDefault: boolean
}

function useActiveProjectId(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const match = pathname.match(/^\/projects\/([^/]+)/)
  const raw = match?.[1] ?? null
  if (!raw) return null
  if (raw === "new" || raw === "import") return null
  return raw
}

function AppHeader({ showSidebarToggle = true }: { showSidebarToggle?: boolean }) {
  const { authDisabled } = useAuthState()
  const projectId = useActiveProjectId()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search })
  const { data: session } = authClient.useSession()

  const currentUser = useQuery({
    ...convexQuery(api.users.getCurrent, {}),
    gcTime: 60_000,
  })
  const userLabel =
    currentUser.data?.email ||
    currentUser.data?.name ||
    session?.user?.email ||
    session?.user?.name ||
    "Account"

  const projectsQuery = useQuery({
    ...convexQuery(api.projects.list, {}),
    gcTime: 5_000,
  })
  const projects = (projectsQuery.data || []) as ProjectOption[]
  const activeProject = projectId
    ? projects.find((p) => p._id === (projectId as Id<"projects">)) || null
    : null

  const configQuery = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    enabled: Boolean(projectId),
    queryFn: async () =>
      await getClawdletsConfig({
        data: { projectId: projectId as Id<"projects"> },
      }),
  })
  const config = configQuery.data?.config as any
  const hostNames = React.useMemo(
    () => Object.keys(config?.hosts || {}).sort(),
    [config],
  )
  const hostParam = React.useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get("host")?.trim() || ""
  }, [search])
  const hostSelection = useHostSelection({
    hosts: hostNames,
    defaultHost: config?.defaultHost || null,
    mode: hostParam ? "required" : "optional",
  })
  const hostOptions = React.useMemo<HostOption[]>(
    () =>
      hostNames.map((name) => ({
        name,
        enabled: config?.hosts?.[name]?.enable !== false,
        isDefault: config?.defaultHost === name,
      })),
    [config, hostNames],
  )

  const handleProjectSelect = React.useCallback(
    (next: Id<"projects">) => {
      const currentPrefix = projectId ? `/projects/${projectId}` : ""
      const nextPrefix = `/projects/${next}`
      const nextPath =
        currentPrefix && pathname.startsWith(currentPrefix)
          ? pathname.replace(currentPrefix, nextPrefix)
          : `${nextPrefix}/dashboard`
      void router.navigate({
        to: nextPath,
      } as any)
    },
    [pathname, projectId, router],
  )

  const handleHostSelect = React.useCallback(
    (next: string) => {
      hostSelection.setHostParam(next)
    },
    [hostSelection],
  )

  const handleManageHosts = React.useMemo(
    () =>
      projectId
        ? () => {
            void router.navigate({
              to: `/projects/${projectId}/hosts/overview`,
              search: {},
            } as any)
          }
        : undefined,
    [projectId, router],
  )

  return (
    <header className="border-b bg-background">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
        <div className="h-14 flex items-center gap-3">
          <div className="min-w-0 flex items-center gap-2">
            {showSidebarToggle ? <SidebarTrigger /> : null}
            <Link
              to="/projects"
              search={{}}
              className="font-black tracking-tight text-lg leading-none shrink-0"
              aria-label="Clawdlets"
            >
              Clawdlets
            </Link>
            <BreadcrumbSlash />
            <ProjectSwitcher
              projects={projects}
              activeProjectId={activeProject?._id || null}
              activeLabel={activeProject?.name || "Select project"}
              disabled={projectsQuery.isPending}
              onSelect={handleProjectSelect}
              onNew={() => void router.navigate({ to: "/projects/new" })}
              onViewAll={() => void router.navigate({ to: "/projects" })}
            />
            {hostParam ? (
              <>
                <BreadcrumbSlash />
                <HostSwitcher
                  hosts={hostOptions}
                  activeHost={hostSelection.host || ""}
                  disabled={!projectId || hostOptions.length === 0}
                  onSelect={handleHostSelect}
                  onManage={handleManageHosts}
                />
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button
              size="icon-sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/projects/new" />}
              aria-label="New project"
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            </Button>
            <ModeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost" aria-label="Menu">
                    <HugeiconsIcon
                      icon={MoreHorizontalCircle01Icon}
                      strokeWidth={2}
                    />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="truncate">
                  {userLabel}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {authDisabled ? (
                  <DropdownMenuItem disabled>Auth disabled</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => {
                      void (async () => {
                        await authClient.signOut()
                        await router.invalidate()
                        await router.navigate({ to: "/sign-in" })
                      })()
                    }}
                  >
                    Sign out
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<a href="https://github.com/regenrek/clawdlets" />}
                >
                  <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
                  GitHub
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}

function BreadcrumbSlash() {
  return <span className="text-muted-foreground/70 px-1">/</span>
}

function SwitcherButton({
  label,
  value,
  disabled,
  className,
  ...rest
}: {
  label: string
  value: string
  disabled?: boolean
  className?: string
} & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      className={cn("h-8 px-2 gap-2 max-w-[280px]", className)}
      {...rest}
    >
      <span className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className="truncate text-sm font-medium">
        {value}
      </span>
      <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
    </Button>
  )
}

function ProjectSwitcher(props: {
  projects: ProjectOption[]
  activeProjectId: Id<"projects"> | null
  activeLabel: string
  disabled?: boolean
  onSelect: (projectId: Id<"projects">) => void
  onNew: () => void
  onViewAll: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const sorted = React.useMemo(
    () =>
      [...props.projects].sort((a, b) => {
        const aSeen = typeof a.lastSeenAt === "number" ? a.lastSeenAt : 0
        const bSeen = typeof b.lastSeenAt === "number" ? b.lastSeenAt : 0
        if (aSeen !== bSeen) return bSeen - aSeen
        return b.updatedAt - a.updatedAt
      }),
    [props.projects],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={props.disabled}
        render={(triggerProps) => (
          <SwitcherButton
            {...triggerProps}
            label="Projects"
            value={props.activeLabel}
            disabled={props.disabled}
          />
        )}
      />
      <PopoverContent className="p-0 w-[340px]" align="start">
        <Command>
          <CommandInput placeholder="Find project..." />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup heading="Projects">
              {sorted.map((project) => (
                <CommandItem
                  key={project._id}
                  value={project.name}
                  data-checked={project._id === props.activeProjectId}
                  onSelect={() => {
                    props.onSelect(project._id)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground capitalize">
                    {project.status}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem
                value="new-project"
                onSelect={() => {
                  props.onNew()
                  setOpen(false)
                }}
              >
                New project
              </CommandItem>
              <CommandItem
                value="view-projects"
                onSelect={() => {
                  props.onViewAll()
                  setOpen(false)
                }}
              >
                View all
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function HostSwitcher(props: {
  hosts: HostOption[]
  activeHost: string
  disabled?: boolean
  onSelect: (host: string) => void
  onManage?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const label = props.activeHost || "Select host"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={props.disabled}
        render={(triggerProps) => (
          <SwitcherButton
            {...triggerProps}
            label="Host"
            value={label}
            disabled={props.disabled}
          />
        )}
      />
      <PopoverContent className="p-0 w-[300px]" align="start">
        <Command>
          <CommandInput placeholder="Find host..." />
          <CommandList>
            <CommandEmpty>No hosts found.</CommandEmpty>
            <CommandGroup heading="Hosts">
              {props.hosts.map((host) => (
                <CommandItem
                  key={host.name}
                  value={host.name}
                  data-checked={host.name === props.activeHost}
                  onSelect={() => {
                    props.onSelect(host.name)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{host.name}</span>
                  {!host.enabled ? (
                    <Badge variant="outline" className="ml-auto text-[0.6rem]">
                      disabled
                    </Badge>
                  ) : host.isDefault ? (
                    <Badge variant="outline" className="ml-auto text-[0.6rem]">
                      default
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {props.onManage ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  <CommandItem
                    value="manage-hosts"
                    onSelect={() => {
                      props.onManage?.()
                      setOpen(false)
                    }}
                  >
                    Manage hosts
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { AppHeader }
