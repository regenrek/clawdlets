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
import { Separator } from "~/components/ui/separator"
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
import { useProjectsList } from "~/lib/project-data"
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

function AppHeader({ showSidebarToggle = true }: { showSidebarToggle?: boolean }) {
  const { authDisabled } = useAuthState()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: session } = authClient.useSession()
  const instanceHost = getInstanceHostFromWindow()
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname) || ""

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

  const projectsQuery = useProjectsList()
  const projects = (projectsQuery.data || []) as ProjectOption[]
  const activeProject = projectSlug
    ? projects.find((p) => slugifyProjectName(p.name) === projectSlug) || null
    : null
  const projectId = activeProject?._id ?? null

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
      const nextProject = projects.find((p) => p._id === next)
      if (!nextProject) return
      const nextSlug = slugifyProjectName(nextProject.name)
      storeLastProjectSlug(nextSlug)
      void router.navigate({
        to: buildProjectBasePath(nextSlug),
      } as any)
    },
    [projects, router],
  )

  const handleHostSelect = React.useCallback(
    (next: string) => {
      if (!projectSlug) return
      const parts = pathname.split("/").filter(Boolean)
      const suffix =
        parts[1] === "hosts" && parts[2]
          ? parts.slice(3).join("/")
          : ""
      const base = buildHostPath(projectSlug, next)
      const target = suffix ? `${base}/${suffix}` : base
      void router.navigate({ to: target } as any)
    },
    [pathname, projectSlug, router],
  )

  const handleManageHosts = React.useMemo(
    () =>
      projectSlug
        ? () => {
          void router.navigate({
            to: buildHostsPath(projectSlug),
          } as any)
        }
        : undefined,
    [projectSlug, router],
  )

  return (
    <header className="bg-background sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b px-4">
      {showSidebarToggle ? <SidebarTrigger className="-ml-1" /> : null}
      <Separator orientation="vertical" className="mr-2 h-full" />
      <div className="min-w-0 flex items-center gap-2">
        <Link
          to={projectSlug ? buildProjectBasePath(projectSlug) : "/"}
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
        {projectSlug ? (
          <>
            <BreadcrumbSlash />
            <HostSwitcher
              hosts={hostOptions}
              activeHost={activeHost || ""}
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
