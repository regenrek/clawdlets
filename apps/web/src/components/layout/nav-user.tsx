"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { ChevronsUpDown, LogOut, Settings } from "lucide-react"

import { api } from "../../../convex/_generated/api"
import { authClient } from "~/lib/auth-client"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar"

function getInitials(value: string) {
  const normalized = value.trim()
  if (!normalized) return "U"
  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function NavUser() {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const { data: session, isPending } = authClient.useSession()
  const canQuery = Boolean(session?.session?.id) && !isPending

  const currentUser = useQuery({
    ...convexQuery(api.users.getCurrent, {}),
    enabled: canQuery,
    gcTime: 60_000,
  })

  const name =
    currentUser.data?.name ||
    session?.user?.name ||
    session?.user?.email ||
    "Account"
  const email = currentUser.data?.email || session?.user?.email || ""
  const avatar =
    currentUser.data?.pictureUrl ||
    (session?.user as { image?: string } | undefined)?.image ||
    ""
  const initials = getInitials(name || email || "User")

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  {avatar ? <AvatarImage src={avatar} alt={name} /> : null}
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs text-muted-foreground">{email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    {avatar ? <AvatarImage src={avatar} alt={name} /> : null}
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">{email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  void router.navigate({ to: "/settings/account" })
                }}
              >
                <Settings />
                User settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  void (async () => {
                    await authClient.signOut()
                    await router.invalidate()
                    await router.navigate({ to: "/sign-in" })
                  })()
                }}
              >
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
