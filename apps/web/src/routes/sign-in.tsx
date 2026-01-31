import { createFileRoute, useRouter } from "@tanstack/react-router";
import * as React from "react";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export const Route = createFileRoute("/sign-in")({
  component: SignIn,
});

function SignIn() {
  return <AuthEnabledSignIn />;
}

function AuthEnabledSignIn() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (session?.session?.id) {
      void router.navigate({ to: "/" });
    }
  }, [router, session?.session?.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "sign-up") {
        await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
        });
      } else {
        await authClient.signIn.email({
          email: email.trim(),
          password,
        });
      }
      await router.invalidate();
      void router.navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md p-6">
        <div className="space-y-2">
          <div className="text-2xl font-black tracking-tight">
            {mode === "sign-up" ? "Create account" : "Sign in"}
          </div>
          <div className="text-muted-foreground text-sm">
            {mode === "sign-up"
              ? "Create an admin account to manage your Clawdlets projects."
              : "Use your account to access your Clawdlets projects."}
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {mode === "sign-up" ? (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? (
            <div className="text-sm text-destructive">{error}</div>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy || isPending}>
            {busy || isPending ? "Working…" : mode === "sign-up" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground underline underline-offset-4"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? "Create an account" : "Have an account? Sign in"}
          </button>
        </div>
      </Card>
    </div>
  );
}
