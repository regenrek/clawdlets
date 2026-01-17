import http from "node:http";
import { URL } from "node:url";
import {
  ClfJobsCancelResponseSchema,
  ClfJobsEnqueueRequestSchema,
  ClfJobsEnqueueResponseSchema,
  ClfJobsListResponseSchema,
  ClfJobsShowResponseSchema,
  type ClfJobsCancelResponse,
  type ClfJobsEnqueueRequest,
  type ClfJobsEnqueueResponse,
  type ClfJobsListResponse,
  type ClfJobsShowResponse,
} from "./protocol.js";

export type ClfClientOpts = {
  socketPath: string;
};

export type ClfClient = {
  enqueue(req: ClfJobsEnqueueRequest): Promise<ClfJobsEnqueueResponse>;
  list(params?: { requester?: string; status?: string; kind?: string; limit?: number }): Promise<ClfJobsListResponse>;
  show(jobId: string): Promise<ClfJobsShowResponse>;
  cancel(jobId: string): Promise<ClfJobsCancelResponse>;
  health(): Promise<{ ok: true }>;
};

async function readBody(res: http.IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let out = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      out += chunk;
    });
    res.on("end", () => resolve(out));
    res.on("error", reject);
  });
}

async function requestJson(params: {
  socketPath: string;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}): Promise<{ status: number; json: unknown }> {
  const u = new URL(`http://localhost${params.path}`);
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      if (v === undefined) continue;
      const s = String(v);
      if (!s) continue;
      u.searchParams.set(k, s);
    }
  }

  const payload = params.body === undefined ? "" : JSON.stringify(params.body);

  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(
      {
        socketPath: params.socketPath,
        method: params.method,
        path: u.pathname + u.search,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : undefined,
      },
      resolve,
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

  const body = await readBody(res);
  let json: unknown = {};
  if (body.trim()) {
    try {
      json = JSON.parse(body);
    } catch {
      json = { error: { message: "invalid json response", body } };
    }
  }

  return { status: res.statusCode || 0, json };
}

export function createClfClient(opts: ClfClientOpts): ClfClient {
  const socketPath = String(opts.socketPath || "").trim();
  if (!socketPath) throw new Error("socketPath missing");

  return {
    health: async () => {
      const res = await requestJson({ socketPath, method: "GET", path: "/healthz" });
      if (res.status !== 200) throw new Error(`health failed: HTTP ${res.status}`);
      return { ok: true };
    },

    enqueue: async (req) => {
      const parsedReq = ClfJobsEnqueueRequestSchema.parse(req);
      const res = await requestJson({ socketPath, method: "POST", path: "/v1/jobs/enqueue", body: parsedReq });
      if (res.status !== 200) throw new Error(`enqueue failed: HTTP ${res.status}: ${JSON.stringify(res.json)}`);
      return ClfJobsEnqueueResponseSchema.parse(res.json);
    },

    list: async (params) => {
      const res = await requestJson({
        socketPath,
        method: "GET",
        path: "/v1/jobs",
        query: {
          ...(params?.requester ? { requester: params.requester } : {}),
          ...(params?.status ? { status: params.status } : {}),
          ...(params?.kind ? { kind: params.kind } : {}),
          ...(params?.limit ? { limit: params.limit } : {}),
        },
      });
      if (res.status !== 200) throw new Error(`list failed: HTTP ${res.status}: ${JSON.stringify(res.json)}`);
      return ClfJobsListResponseSchema.parse(res.json);
    },

    show: async (jobId) => {
      const id = String(jobId || "").trim();
      if (!id) throw new Error("jobId missing");
      const res = await requestJson({ socketPath, method: "GET", path: `/v1/jobs/${encodeURIComponent(id)}` });
      if (res.status !== 200) throw new Error(`show failed: HTTP ${res.status}: ${JSON.stringify(res.json)}`);
      return ClfJobsShowResponseSchema.parse(res.json);
    },

    cancel: async (jobId) => {
      const id = String(jobId || "").trim();
      if (!id) throw new Error("jobId missing");
      const res = await requestJson({ socketPath, method: "POST", path: `/v1/jobs/${encodeURIComponent(id)}/cancel` });
      if (res.status !== 200) throw new Error(`cancel failed: HTTP ${res.status}: ${JSON.stringify(res.json)}`);
      return ClfJobsCancelResponseSchema.parse(res.json);
    },
  };
}

