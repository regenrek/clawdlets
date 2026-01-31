import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import * as React from "react"
import { authClient } from "~/lib/auth-client"
import { api } from "../../../convex/_generated/api"
import { Button } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Separator } from "~/components/ui/separator"

export const Route = createFileRoute("/settings/account")({
  component: AccountSettings,
})

function AccountSettings() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading
  const currentUser = useQuery({
    ...convexQuery(api.users.getCurrent, {}),
    enabled: canQuery,
    gcTime: 60_000,
  })
  const user = currentUser.data
  const name = user?.name || session?.user?.name || session?.user?.email || "Account"
  const email = user?.email || session?.user?.email || ""
  const role = user?.role || "viewer"

  const [displayName, setDisplayName] = React.useState(name)
  const [newEmail, setNewEmail] = React.useState(email)
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [nextPassword, setNextPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDisplayName(name)
  }, [name])

  React.useEffect(() => {
    setNewEmail(email)
  }, [email])

  async function onUpdateName(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    const nextName = displayName.trim()
    if (!nextName) {
      setError("Display name is required.")
      return
    }
    setBusy(true)
    try {
      await authClient.updateUser({ name: nextName })
      await currentUser.refetch()
      setSuccess("Display name updated.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onUpdateEmail(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    const next = newEmail.trim()
    if (!next) {
      setError("Email is required.")
      return
    }
    setBusy(true)
    try {
      const callbackURL = `${window.location.origin}/settings/account`
      await authClient.changeEmail({ newEmail: next, callbackURL })
      await currentUser.refetch()
      setSuccess("Email change requested.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onUpdatePassword(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    if (!currentPassword || !nextPassword) {
      setError("Enter current and new password.")
      return
    }
    if (nextPassword.length < 8) {
      setError("New password must be at least 8 characters.")
      return
    }
    if (nextPassword !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    setBusy(true)
    try {
      await authClient.changePassword({
        currentPassword,
        newPassword: nextPassword,
      })
      setCurrentPassword("")
      setNextPassword("")
      setConfirmPassword("")
      setSuccess("Password updated.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">User settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and sign out.
        </p>
      </div>

      <Card className="p-6 space-y-6">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Name</div>
          <div className="font-medium">{name}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Email</div>
          <div className="font-medium">{email || "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Role</div>
          <div className="font-medium capitalize">{role}</div>
        </div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {success ? <div className="text-sm text-emerald-600">{success}</div> : null}
        <Separator />
        <form onSubmit={onUpdateName} className="space-y-3">
          <div className="text-sm font-medium">Display name</div>
          <div className="grid gap-2">
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            Update name
          </Button>
        </form>
        <Separator />
        <form onSubmit={onUpdateEmail} className="space-y-3">
          <div className="text-sm font-medium">Email</div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Email change may require verification depending on auth settings.
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            Update email
          </Button>
        </form>
        <Separator />
        <form onSubmit={onUpdatePassword} className="space-y-3">
          <div className="text-sm font-medium">Password</div>
          <div className="grid gap-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            Update password
          </Button>
        </form>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Sign out from this device.
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void (async () => {
                await authClient.signOut()
                await router.invalidate()
                await router.navigate({ to: "/sign-in" })
              })()
            }}
          >
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  )
}
