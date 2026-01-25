/// <reference types="vite/client" />
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import * as React from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { ConvexQueryClient } from "@convex-dev/react-query"
import { useConvexMutation } from "@convex-dev/react-query"
import { ConvexProvider, useConvexAuth } from "convex/react"
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary"
import { NotFound } from "~/components/NotFound"
import { ThemeInitScript } from "~/components/theme-init-script"
import { ThemeProvider } from "~/components/theme-provider"
import { getTheme, type Theme } from "~/lib/theme"
import appCss from "~/styles/app.css?url"
import { seo } from "~/utils/seo"
import { AppShell } from "~/components/layout/app-shell"
import { Toaster } from "~/components/ui/sonner"
import { api } from "../../convex/_generated/api"
import { getAuthBootstrap } from "~/sdk/auth"
import { authClient } from "~/lib/auth-client"
import { AuthStateProvider } from "~/lib/auth-state"
import { parseProjectSlug } from "~/lib/project-routing"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  beforeLoad: async ({ location, context }) => {
    const { authDisabled, token } = await getAuthBootstrap()

    if (token && context.convexQueryClient.serverHttpClient) {
      context.convexQueryClient.serverHttpClient.setAuth(token)
    }

    if (!authDisabled) {
      const pathname = location.pathname
      const isAuthRoute = pathname === "/sign-in" || pathname.startsWith("/api/auth/")
      if (!isAuthRoute && !token) {
        throw redirect({ to: "/sign-in" })
      }
    }

    return { authDisabled, token }
  },
  loader: () => getTheme(),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      ...seo({
        title: "Clawdlets",
        description: "Self-hosted web UI for managing Clawdbot fleets.",
      }),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
      { rel: "manifest", href: "/site.webmanifest", color: "#fffff" },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  errorComponent: (props) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    )
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
})

function RootComponent() {
  const { authDisabled, token } = Route.useRouteContext()
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const showShell = pathname !== "/sign-in"
  const projectSlug = parseProjectSlug(pathname)
  const showSidebar = Boolean(projectSlug)

  const app = showShell ? (
    <AppShell showSidebar={showSidebar}>
      <Outlet />
    </AppShell>
  ) : (
    <Outlet />
  )

  return authDisabled ? (
    <RootDocument>
      <ConvexProvider client={convexQueryClient.convexClient}>
        <AuthStateProvider value={{ authDisabled: true }}>
          <EnsureDevUser />
          {app}
        </AuthStateProvider>
      </ConvexProvider>
    </RootDocument>
  ) : (
    <RootDocument>
      <ConvexBetterAuthProvider
        client={convexQueryClient.convexClient}
        authClient={authClient}
        initialToken={token}
      >
        <AuthStateProvider value={{ authDisabled: false }}>
          <EnsureAuthedUser />
          {app}
        </AuthStateProvider>
      </ConvexBetterAuthProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme
  return (
    <html lang="en" className={initial === "system" ? "" : initial}>
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider initial={initial}>
          {children}
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function EnsureDevUser() {
  const ensureCurrent = useConvexMutation(api.users.ensureCurrent)
  React.useEffect(() => {
    void ensureCurrent({})
  }, [ensureCurrent])
  return null
}

function EnsureAuthedUser() {
  const ensureCurrent = useConvexMutation(api.users.ensureCurrent)
  const { isAuthenticated, isLoading } = useConvexAuth()

  React.useEffect(() => {
    if (isLoading || !isAuthenticated) return
    void ensureCurrent({})
  }, [ensureCurrent, isAuthenticated, isLoading])

  return null
}
