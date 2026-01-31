"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "~/components/ui/alert-dialog"
import { Button } from "~/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "~/components/ui/field"
import { LabelWithHelp } from "~/components/ui/label-help"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { Spinner } from "~/components/ui/spinner"

type DeploySource = "local" | "remote"

type RepoStatus = {
  localHead?: string | null
  originHead?: string | null
  upstream?: string | null
  branch?: string | null
  dirty?: boolean
  ahead?: number | null
  behind?: number | null
  needsPush?: boolean
  canPush?: boolean
  pushBlockedReason?: string | null
}

export function BootstrapDeploySourceSection(props: {
  help: ReactNode
  mode: "nixos-anywhere" | "image"
  deploySource: DeploySource
  onDeploySourceChange: (v: DeploySource) => void
  requiresFlake: boolean
  repoStatus: {
    isPending: boolean
    isFetching: boolean
    error: unknown
    data?: RepoStatus
  }
  formatSha: (sha?: string | null) => string
  onRefresh: () => void
  onPushNow: () => void
  isPushing: boolean
}) {
  const { deploySource, onDeploySourceChange, repoStatus, requiresFlake, formatSha, onRefresh, onPushNow, isPushing, mode } = props
  const [detailsOpen, setDetailsOpen] = useState(false)

  const repo = repoStatus.data
  const localSelected = deploySource === "local"

  const missingLocalRev = requiresFlake && localSelected && !repo?.localHead
  const missingRemoteRev = requiresFlake && !localSelected && !repo?.originHead
  const needsPush = requiresFlake && localSelected && Boolean(repo?.needsPush)
  const pushBlocked = needsPush && !repo?.canPush

  return (
    <div className="space-y-2">
      <LabelWithHelp help={props.help}>
        Deploy source
      </LabelWithHelp>

      <RadioGroup value={deploySource} onValueChange={(value) => onDeploySourceChange(value as DeploySource)}>
        <FieldLabel htmlFor="deploy-source-local">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Local deploy</FieldTitle>
              <FieldDescription>
                Deploy your current local commit (local HEAD). Requires pushing so the host can fetch the commit.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="local" id="deploy-source-local" />
          </Field>
        </FieldLabel>

        <FieldLabel htmlFor="deploy-source-remote">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Remote deploy (Team / CI)</FieldTitle>
              <FieldDescription>
                Deploy the last pushed commit from your remote. Local changes are ignored until pushed.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="remote" id="deploy-source-remote" />
          </Field>
        </FieldLabel>
      </RadioGroup>

      {mode === "image" ? (
        <div className="text-xs text-muted-foreground">
          Image bootstrap ignores git rev selection.
        </div>
      ) : null}

      <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">{localSelected ? "Local status" : "Remote status"}</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={repoStatus.isFetching}
            onClick={onRefresh}
          >
            {repoStatus.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {repoStatus.isPending ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3" />
            Checking repo…
          </div>
        ) : repoStatus.error ? (
          <div className="text-sm text-destructive">{String(repoStatus.error)}</div>
        ) : repo ? (
          <div className="space-y-2">
            {localSelected ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>local HEAD</span>
                  <code>{formatSha(repo.localHead)}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span>remote</span>
                  <span>{repo.upstream || "not configured"}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>latest pushed</span>
                  <code>{formatSha(repo.originHead)}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span>remote</span>
                  <span>{repo.upstream || "not configured"}</span>
                </div>
              </div>
            )}

            {requiresFlake && localSelected && repo.dirty ? (
              <div className="text-xs text-muted-foreground">
                Uncommitted changes are not included in deploy. Commit first if you want them deployed.
              </div>
            ) : null}

            {requiresFlake && missingLocalRev ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive space-y-1">
                <div className="font-medium">Local revision not available</div>
                <div className="text-xs">
                  We can’t determine your local HEAD commit. Refresh, or check your repo state.
                </div>
              </div>
            ) : null}

            {requiresFlake && missingRemoteRev ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive space-y-1">
                <div className="font-medium">Remote not ready</div>
                <div className="text-xs">
                  We can’t determine the last pushed commit. Configure a remote and push at least once, then refresh.
                </div>
                <div className="text-xs">
                  Quick fix:
                  <pre className="mt-1 whitespace-pre-wrap break-words">
git remote add origin &lt;repo-url&gt;
git push -u origin HEAD
                  </pre>
                </div>
              </div>
            ) : null}

            {requiresFlake && !localSelected && repo.needsPush ? (
              <div className="text-xs text-muted-foreground">
                You have local commits not pushed. Remote deploy will deploy the last pushed version. Switch to Local deploy if you want to deploy your current commit (and push).
              </div>
            ) : null}

            {requiresFlake && needsPush ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs text-muted-foreground">
                  Push required: your local commit isn’t on the remote yet.
                </div>
                {repo.canPush ? (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button type="button" size="sm" variant="outline" disabled={isPushing}>
                          {isPushing ? "Pushing…" : "Push now"}
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Push this branch to the remote?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This runs <code>git push</code> in your local repo.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onPushNow}>
                          {isPushing ? "Pushing…" : "Push now"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <div className="text-xs text-destructive">
                    {pushBlocked ? (repo.pushBlockedReason || "Push blocked.") : null}
                  </div>
                )}
              </div>
            ) : null}

            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger
                render={
                  <Button type="button" size="sm" variant="ghost">
                    {detailsOpen ? "Hide details" : "Show details"}
                  </Button>
                }
              />
              <CollapsibleContent className="pt-2">
                <div className="grid gap-1 text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>local HEAD</span>
                    <code>{formatSha(repo.localHead)}</code>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>origin HEAD</span>
                    <code>{formatSha(repo.originHead)}</code>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>branch</span>
                    <span>{repo.branch || "unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>upstream</span>
                    <span>{repo.upstream || "unset"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>dirty</span>
                    <span>{repo.dirty ? "yes" : "no"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>ahead/behind</span>
                    <span>{repo.ahead ?? 0} / {repo.behind ?? 0}</span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : null}
      </div>
    </div>
  )
}

