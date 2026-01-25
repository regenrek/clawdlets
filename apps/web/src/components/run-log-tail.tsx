import { useMutation, useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useRouter } from "@tanstack/react-router";
import * as React from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Button } from "~/components/ui/button";
import { cancelRun } from "~/sdk/runs";

export function RunLogTail({ runId }: { runId: Id<"runs"> }) {
  const router = useRouter();
  const convexQueryClient = router.options.context.convexQueryClient;

  const runQuery = useQuery({ ...convexQuery(api.runs.get, { runId }), gcTime: 5_000 });
  const pageQuery = useQuery({
    ...convexQuery(api.runEvents.pageByRun, { runId, paginationOpts: { numItems: 300, cursor: null } }),
    gcTime: 5_000,
  });

  const [olderPages, setOlderPages] = React.useState<any[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [isDone, setIsDone] = React.useState(false);

  React.useEffect(() => {
    setOlderPages([]);
    setCursor(null);
    setIsDone(false);
  }, [runId]);

  React.useEffect(() => {
    if (!pageQuery.data) return;
    if (olderPages.length > 0) return;
    if (cursor !== null) return;
    setCursor(pageQuery.data.continueCursor);
    setIsDone(pageQuery.data.isDone);
  }, [cursor, olderPages.length, pageQuery.data]);

  const loadOlder = useMutation({
    mutationFn: async () => {
      if (!cursor || isDone) return null;
      const args = { runId, paginationOpts: { numItems: 300, cursor } };
      if (convexQueryClient.serverHttpClient) {
        return await convexQueryClient.serverHttpClient.consistentQuery(api.runEvents.pageByRun, args);
      }
      return await convexQueryClient.convexClient.query(api.runEvents.pageByRun, args);
    },
    onSuccess: (res) => {
      if (!res) return;
      setOlderPages((prev) => [...prev, res]);
      setCursor(res.continueCursor);
      setIsDone(res.isDone);
    },
  });

  const eventsDesc = [
    ...(pageQuery.data?.page ?? []),
    ...olderPages.flatMap((p) => p.page as any[]),
  ];
  const seen = new Set<string>();
  const events = eventsDesc
    .slice()
    .reverse()
    .filter((e: any) => {
      if (seen.has(e._id)) return false;
      seen.add(e._id);
      return true;
    });
  const run = runQuery.data?.run;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="min-w-0">
          <div className="font-medium truncate">{run?.title || "Run"}</div>
          <div className="text-muted-foreground text-xs">
            Status: {run?.status ?? "…"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pageQuery.data && !isDone ? (
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={loadOlder.isPending}
              onClick={() => loadOlder.mutate()}
            >
              {loadOlder.isPending ? "Loading…" : "Load older"}
            </Button>
          ) : null}
          {run?.status === "running" ? (
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => void cancelRun({ data: { runId } })}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <div className="p-4">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words max-h-[420px] overflow-auto">
          {pageQuery.isPending ? (
            <span className="text-muted-foreground">Loading…</span>
          ) : events.length === 0 ? (
            <span className="text-muted-foreground">No logs yet.</span>
          ) : (
            events.map((e) => `${new Date(e.ts).toLocaleTimeString()} ${e.level} ${e.message}`).join("\n")
          )}
        </pre>
      </div>
    </div>
  );
}
