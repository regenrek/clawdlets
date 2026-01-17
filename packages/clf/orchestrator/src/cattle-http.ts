import http from "node:http";
import { type ClfQueue } from "@clawdlets/clf-queue";
import { EnvVarNameSchema } from "@clawdlets/core/lib/identifiers";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2) + "\n";
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(text);
}

function isHttpWhitespace(code: number): boolean {
  // Header ABNF: OWS allows SP / HTAB.
  return code === 0x20 || code === 0x09;
}

function readBearerToken(req: http.IncomingMessage): string {
  const h = String(req.headers.authorization || "").trim();
  if (!h) return "";

  const prefix = "bearer";
  if (h.length <= prefix.length) return "";
  if (h.slice(0, prefix.length).toLowerCase() !== prefix) return "";

  let i = prefix.length;
  if (i >= h.length || !isHttpWhitespace(h.charCodeAt(i))) return "";
  while (i < h.length && isHttpWhitespace(h.charCodeAt(i))) i++;
  return h.slice(i).trim();
}

function isSafeEnvVarName(value: string): boolean {
  return EnvVarNameSchema.safeParse(value).success;
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
        if (!isSafeEnvVarName(key)) {
          json(res, 400, { ok: false, error: { message: `invalid env var name: ${key}` } });
          return;
        }
        env[key] = String(v ?? "");
      }
      for (const k of bootstrap.envKeys || []) {
        const key = String(k || "").trim();
        if (!key) continue;
        if (!isSafeEnvVarName(key)) {
          json(res, 400, { ok: false, error: { message: `invalid env var name: ${key}` } });
          return;
        }
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
