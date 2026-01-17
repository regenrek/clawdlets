import http from "node:http";
import { type ClfQueue } from "@clawdlets/clf-queue";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2) + "\n";
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(text);
}

function readBearerToken(req: http.IncomingMessage): string {
  const h = String(req.headers.authorization || "").trim();
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || "").trim() : "";
}

export function createCattleInternalHttpServer(params: {
  queue: ClfQueue;
  env: NodeJS.ProcessEnv;
}): http.Server {
  return http.createServer((req, res) => {
    const method = String(req.method || "").toUpperCase();
    const url = new URL(String(req.url || "/"), "http://localhost");

    if (method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/v1/cattle/env") {
      const token = readBearerToken(req);
      if (!token) {
        json(res, 401, { ok: false, error: { message: "missing bearer token" } });
        return;
      }

      const bootstrap = params.queue.consumeCattleBootstrapToken({ token });
      if (!bootstrap) {
        json(res, 401, { ok: false, error: { message: "invalid/expired token" } });
        return;
      }

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(bootstrap.publicEnv || {})) {
        const key = String(k || "").trim();
        if (!key) continue;
        env[key] = String(v ?? "");
      }
      for (const k of bootstrap.envKeys || []) {
        const key = String(k || "").trim();
        if (!key) continue;
        const v = String(params.env[key] || "").trim();
        if (!v) {
          json(res, 500, { ok: false, error: { message: `missing required env var on control plane: ${key}` } });
          return;
        }
        env[key] = v;
      }

      json(res, 200, { ok: true, env });
      return;
    }

    json(res, 404, { ok: false, error: { message: "not found" } });
  });
}

