import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import {
  ArrowPathIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CodeBracketSquareIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  ClipboardDocumentCheckIcon,
  DocumentTextIcon,
  FolderIcon,
  KeyIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  ServerStackIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline"
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

function AppSidebarContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectId = useActiveProjectId()

  const base: NavItem[] = [
    {
      to: "/projects",
      label: "Projects",
      icon: FolderIcon,
      tooltip: "Browse projects on this machine. Create new or import existing repos.",
    },
  ]

  const projectBase = projectId ? `/projects/${projectId}` : null
  const setup: NavItem[] = projectBase
    ? [
        {
          to: `${projectBase}/setup/fleet`,
          label: "Fleet",
          icon: Cog6ToothIcon,
          tooltip: "Edit fleet config (bots, providers, skills, workspaces).",
        },
        {
          to: `${projectBase}/setup/settings`,
          label: "Project Settings",
          icon: Cog6ToothIcon,
          tooltip: "Local operator creds: HCLOUD_TOKEN, GITHUB_TOKEN, SOPS_AGE_KEY_FILE, NIX_BIN.",
        },
        {
          to: `${projectBase}/setup/hosts`,
          label: "Hosts",
          icon: ServerStackIcon,
          tooltip: "Host settings: SSH target, admin CIDR, Hetzner params, tailnet, models.",
        },
        {
          to: `${projectBase}/setup/bots`,
          label: "Bots",
          icon: CpuChipIcon,
          tooltip: "Bot roster: add/remove bots and configure routing.",
        },
        {
          to: `${projectBase}/setup/providers`,
          label: "Providers",
          icon: PuzzlePieceIcon,
          tooltip: "Configure external providers (e.g. Discord) used by the fleet.",
        },
        {
          to: `${projectBase}/setup/models`,
          label: "Models",
          icon: SparklesIcon,
          tooltip: "Model providers, API key mapping, and per-bot defaults.",
        },
        {
          to: `${projectBase}/setup/secrets`,
          label: "Secrets",
          icon: KeyIcon,
          tooltip: "Generate + validate secrets, then sync into the project repo (no secrets stored in Convex).",
        },
        {
          to: `${projectBase}/setup/doctor`,
          label: "Doctor",
          icon: WrenchScrewdriverIcon,
          tooltip: "Run checks for config, repo health, and host readiness; follow fix links.",
        },
        {
          to: `${projectBase}/setup/bootstrap`,
          label: "Bootstrap",
          icon: RocketLaunchIcon,
          tooltip: "Provision + bootstrap a new host and deploy initial system state.",
        },
      ]
    : []

  const operate: NavItem[] = projectBase
    ? [
        {
          to: `${projectBase}/operate/deploy`,
          label: "Deploy",
          icon: CloudArrowUpIcon,
          tooltip: "Apply config changes to the host (build + switch).",
        },
        {
          to: `${projectBase}/operate/logs`,
          label: "Logs",
          icon: DocumentTextIcon,
          tooltip: "View recent run logs and command output for this project.",
        },
        {
          to: `${projectBase}/operate/audit`,
          label: "Audit",
          icon: ClipboardDocumentCheckIcon,
          tooltip: "Security/audit checks for config and infra state; review findings.",
        },
        {
          to: `${projectBase}/operate/restart`,
          label: "Restart",
          icon: ArrowPathIcon,
          tooltip: "Restart selected services/units with safety confirmation.",
        },
      ]
    : []

  const advanced: NavItem[] = projectBase
    ? [
        {
          to: `${projectBase}/advanced/editor`,
          label: "Raw Editor",
          icon: CodeBracketSquareIcon,
          tooltip: "Directly edit raw JSON config. Use only when you know what you’re changing.",
        },
        {
          to: `${projectBase}/advanced/commands`,
          label: "Command Runner",
          icon: CommandLineIcon,
          tooltip: "Run clawdlets CLI commands with structured logs captured as runs.",
        },
        {
          to: `${projectBase}/runs`,
          label: "Runs",
          icon: ClockIcon,
          tooltip: "Run history + event timeline. Debug failures and review actions.",
        },
      ]
    : []

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Home</SidebarGroupLabel>
          <SidebarMenu>
            {base.map((item) => (
              <NavLink key={item.to} item={item} isActive={pathname === item.to} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {projectId ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Setup</SidebarGroupLabel>
              <SidebarMenu>
                {setup.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Operate</SidebarGroupLabel>
              <SidebarMenu>
                {operate.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Advanced</SidebarGroupLabel>
              <SidebarMenu>
                {advanced.map((item) => (
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
