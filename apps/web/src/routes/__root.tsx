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
import { useConvexAuth } from "convex/react"
import { getAuthBootstrap } from "~/sdk/auth"
import { authClient } from "~/lib/auth-client"
import { parseProjectSlug } from "~/lib/project-routing"
import { isAuthError } from "~/lib/auth-utils"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  beforeLoad: async ({ location, context }) => {
    const { token } = await getAuthBootstrap()

    if (token && context.convexQueryClient.serverHttpClient) {
      context.convexQueryClient.serverHttpClient.setAuth(token)
    }

    const pathname = location.pathname
    const isAuthRoute = pathname === "/sign-in" || pathname.startsWith("/api/auth/")
    if (!isAuthRoute && !token) {
      throw redirect({ to: "/sign-in" })
    }

    return { token }
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
      { rel: "manifest", href: "/site.webmanifest", color: "#ffffff" },
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
  const { token } = Route.useRouteContext()
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

  return (
    <RootDocument>
      <ConvexBetterAuthProvider
        client={convexQueryClient.convexClient}
        authClient={authClient}
        initialToken={token}
      >
        <AuthErrorWatcher />
        <RequireSignIn />
        <EnsureAuthedUser />
        <AuthGate app={app} />
      </ConvexBetterAuthProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme
  return (
    <html lang="en" className={initial === "system" ? "" : initial} suppressHydrationWarning>
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

function EnsureAuthedUser() {
  const ensureCurrent = useConvexMutation(api.users.ensureCurrent)
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { data: session, isPending } = authClient.useSession()
  const hasSession = Boolean(session?.user?.id)

  React.useEffect(() => {
    if (isPending || isLoading || !isAuthenticated || !hasSession) return
    void ensureCurrent({}).catch(() => null)
  }, [ensureCurrent, hasSession, isAuthenticated, isLoading, isPending])

  return null
}

function RequireSignIn() {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: session, isPending } = authClient.useSession()
  const { isLoading } = useConvexAuth()

  React.useEffect(() => {
    if (isPending || isLoading) return
    if (pathname === "/sign-in" || pathname.startsWith("/api/auth/")) return
    if (session?.user?.id) return
    void router.navigate({ to: "/sign-in" })
  }, [isLoading, isPending, pathname, router, session?.user?.id])

  return null
}

function AuthGate({ app }: { app: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: session, isPending } = authClient.useSession()
  const { isLoading } = useConvexAuth()
  const isAuthRoute = pathname === "/sign-in" || pathname.startsWith("/api/auth/")
  const hasSession = Boolean(session?.user?.id)

  if (isAuthRoute) return <>{app}</>
  if (isPending || isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-muted-foreground">
        Checking session…
      </div>
    )
  }
  if (!hasSession) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-muted-foreground">
        Redirecting to sign-in…
      </div>
    )
  }

  return <>{app}</>
}

function AuthErrorWatcher() {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const queryClient = router.options.context.queryClient
  const redirectingRef = React.useRef(false)

  React.useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event?.type !== "updated") return
      const error = event.query?.state?.error
      if (!isAuthError(error)) return
      if (pathname === "/sign-in" || pathname.startsWith("/api/auth/")) return
      if (redirectingRef.current) return
      redirectingRef.current = true
      void (async () => {
        try {
          await authClient.signOut()
          await router.invalidate()
        } catch {
          // ignore sign-out failures, still redirect
        } finally {
          await router.navigate({ to: "/sign-in" })
          redirectingRef.current = false
        }
      })()
    })
  }, [pathname, queryClient, router])

  return null
}
