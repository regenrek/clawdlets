import http from "node:http";
import { URL } from "node:url";
import { openClfQueue, type ClfQueue } from "@clawdlets/clf-queue";
import {
  CLF_PROTOCOL_VERSION,
  ClfJobsEnqueueRequestSchema,
  ClfJobsEnqueueResponseSchema,
  ClfJobsListResponseSchema,
  ClfJobsShowResponseSchema,
  ClfJobsCancelResponseSchema,
  type ClfJobsEnqueueResponse,
  type ClfJobsListResponse,
  type ClfJobsShowResponse,
  type ClfJobsCancelResponse,
} from "@clawdlets/clf-queue";
import { parseClfJobPayload } from "@clawdlets/clf-queue";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const safeBody = body instanceof Error ? { error: { message: body.message } } : body;
  const data = JSON.stringify(safeBody);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(data));
  res.end(data);
}

function errorJson(res: http.ServerResponse, status: number, message: string): void {
  json(res, status, { protocolVersion: CLF_PROTOCOL_VERSION, error: { message } });
}

function sanitizeUserErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const firstLine = raw.split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine) return "bad request";
  if (firstLine.length > 200) return `${firstLine.slice(0, 200)}…`;
  return firstLine;
}

async function readJson(req: http.IncomingMessage, limitBytes = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.byteLength;
    if (total > limitBytes) throw new Error(`request body too large (${total} bytes; limit ${limitBytes})`);
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON body: ${String((e as Error)?.message || e)}`);
  }
}

function parseIsoTimeToMs(value: string): number | null {
  const v = String(value || "").trim();
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t <= 0) return null;
  return t;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function toSummary(job: ReturnType<ClfQueue["get"]> extends infer T ? NonNullable<T> : never) {
  return {
    jobId: job.jobId,
    kind: job.kind as any,
    status: job.status as any,
    requester: job.requester,
    idempotencyKey: job.idempotencyKey || "",
    createdAt: msToIso(job.createdAt),
    updatedAt: msToIso(job.updatedAt),
    runAt: msToIso(job.runAt),
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError || "",
    ...(job.result != null ? { result: job.result } : {}),
  };
}

function parseQuery(u: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of u.searchParams.entries()) {
    out[k] = v;
  }
  return out;
}

function splitCsv(value: string | undefined): string[] {
  const v = String(value || "").trim();
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createOrchestratorHttpServer(params: {
  queue: ClfQueue;
}): http.Server {
  const q = params.queue;

  return http.createServer(async (req, res) => {
    try {
      const method = String(req.method || "GET").toUpperCase();
      const u = new URL(String(req.url || "/"), "http://localhost");
      const pathname = u.pathname;

      if (method === "GET" && pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && pathname === "/v1/jobs/enqueue") {
        const body = await readJson(req);
        const parsed = ClfJobsEnqueueRequestSchema.parse(body);

        // Validate payload shape early (ensures job kind registry is coherent).
        parseClfJobPayload(parsed.kind, parsed.payload);

        const runAtMs = parsed.runAt ? parseIsoTimeToMs(parsed.runAt) : null;
        const { jobId } = q.enqueue({
          kind: parsed.kind,
          payload: parsed.payload,
          requester: parsed.requester,
          idempotencyKey: parsed.idempotencyKey,
          runAt: runAtMs ?? Date.now(),
          priority: parsed.priority,
        });

        const out: ClfJobsEnqueueResponse = ClfJobsEnqueueResponseSchema.parse({
          protocolVersion: CLF_PROTOCOL_VERSION,
          jobId,
        });
        json(res, 200, out);
        return;
      }

      if (method === "GET" && pathname === "/v1/jobs") {
        const query = parseQuery(u);
        const requester = String(query.requester || "").trim();
        const statuses = splitCsv(query.status).filter((s) => ["queued", "running", "done", "failed", "canceled"].includes(s)) as any;
        const kinds = splitCsv(query.kind);
        const limitRaw = String(query.limit || "").trim();
        const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : 50;

        const jobs = q.list({
          ...(requester ? { requester } : {}),
          ...(statuses.length > 0 ? { statuses } : {}),
          ...(kinds.length > 0 ? { kinds } : {}),
          limit,
        });

        const out: ClfJobsListResponse = ClfJobsListResponseSchema.parse({
          protocolVersion: CLF_PROTOCOL_VERSION,
          jobs: jobs.map(toSummary),
        });
        json(res, 200, out);
        return;
      }

      const mShow = pathname.match(/^\/v1\/jobs\/([^/]+)$/);
      if (method === "GET" && mShow) {
        const jobId = decodeURIComponent(mShow[1] || "");
        const job = q.get(jobId);
        if (!job) {
          errorJson(res, 404, "job not found");
          return;
        }
        const out: ClfJobsShowResponse = ClfJobsShowResponseSchema.parse({
          protocolVersion: CLF_PROTOCOL_VERSION,
          job: { ...toSummary(job), payload: job.payload ?? null },
        });
        json(res, 200, out);
        return;
      }

      const mCancel = pathname.match(/^\/v1\/jobs\/([^/]+)\/cancel$/);
      if (method === "POST" && mCancel) {
        const jobId = decodeURIComponent(mCancel[1] || "");
        const job = q.get(jobId);
        if (!job) {
          errorJson(res, 404, "job not found");
          return;
        }
        const ok = q.cancel({ jobId });
        if (!ok) {
          errorJson(res, 409, `job not cancelable (status=${job.status})`);
          return;
        }
        const out: ClfJobsCancelResponse = ClfJobsCancelResponseSchema.parse({
          protocolVersion: CLF_PROTOCOL_VERSION,
          ok: true,
        });
        json(res, 200, out);
        return;
      }

      errorJson(res, 404, "not found");
    } catch (e) {
      errorJson(res, 400, sanitizeUserErrorMessage(e));
    }
  });
}
