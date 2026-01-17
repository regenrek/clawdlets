#!/usr/bin/env node
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { openClfQueue } from "@clawdlets/clf-queue";
import { loadClfOrchestratorConfigFromEnv } from "./config.js";
import { createOrchestratorHttpServer } from "./http.js";
import { createCattleInternalHttpServer } from "./cattle-http.js";
import { loadAdminAuthorizedKeys, parseCattleBaseLabels, runClfWorkerLoop, type ClfWorkerRuntime } from "./worker.js";
import { assertSafeUnixSocketPath, tryChmodUnixSocket } from "./unix-socket-safety.js";

function getSystemdListenFd(): number | null {
  const pid = Number(process.env.LISTEN_PID || "");
  const fds = Number(process.env.LISTEN_FDS || "");
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (pid !== process.pid) return null;
  if (!Number.isFinite(fds) || fds <= 0) return null;
  return 3;
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function removeStaleSocket(socketPath: string): void {
  if (!fs.existsSync(socketPath)) return;
  try {
    const st = fs.lstatSync(socketPath);
    if (st.isSocket()) fs.unlinkSync(socketPath);
  } catch {
    // ignore
  }
}

async function listenHttpServer(server: http.Server, socketPath: string): Promise<void> {
  const fd = getSystemdListenFd();
  if (fd != null) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ fd }, () => resolve());
    });
    return;
  }

  ensureDir(path.dirname(socketPath));
  removeStaleSocket(socketPath);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
}

async function listenTcpServer(server: http.Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

function isWildcardHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "0.0.0.0" || h === "::" || h === "[::]";
}

function isProbablyTailscaleIpv4(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (![a, b, c, d].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return false;
  // Tailscale IPv4 range: 100.64.0.0/10.
  return a === 100 && b >= 64 && b <= 127;
}

function resolveTailscaleListenHost(raw: string): string {
  const v = String(raw || "").trim();
  const lower = v.toLowerCase();
  if (v && lower !== "auto") return v;

  const ifs = os.networkInterfaces();
  const addrs = ifs["tailscale0"] || [];
  for (const a of addrs) {
    if (!a) continue;
    if (a.family !== "IPv4") continue;
    if (a.internal) continue;
    return a.address;
  }

  for (const addrs of Object.values(ifs)) {
    for (const a of addrs || []) {
      if (!a) continue;
      if (a.family !== "IPv4") continue;
      if (a.internal) continue;
      if (isProbablyTailscaleIpv4(a.address)) return a.address;
    }
  }

  throw new Error("failed to resolve tailscale listen host (missing tailscale0 IPv4)");
}

async function main(): Promise<void> {
  const cfg = loadClfOrchestratorConfigFromEnv(process.env);

  const q = openClfQueue(cfg.dbPath);
  const server = createOrchestratorHttpServer({ queue: q });
  const cattleServer = createCattleInternalHttpServer({ queue: q, env: process.env });

  const stopSignal = { stopped: false };
  const stop = () => {
    stopSignal.stopped = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await listenHttpServer(server, cfg.socketPath);
  if (getSystemdListenFd() == null) tryChmodUnixSocket(cfg.socketPath, 0o600);
  assertSafeUnixSocketPath(cfg.socketPath);
  console.log(`clf-orchestrator: listening (socket=${cfg.socketPath})`);

  const cattleListenHost = resolveTailscaleListenHost(cfg.cattle.secretsListenHost);
  if (isWildcardHost(cattleListenHost)) {
    throw new Error(`refusing to bind cattle secrets API on wildcard host: ${cattleListenHost} (set CLF_CATTLE_SECRETS_LISTEN_HOST=auto or an explicit tailnet IP)`);
  }
  await listenTcpServer(cattleServer, cattleListenHost, cfg.cattle.secretsListenPort);

  const cattleSecretsBaseUrl = cfg.cattle.secretsBaseUrl || `http://${cattleListenHost}:${cfg.cattle.secretsListenPort}`;
  console.log("clf-orchestrator: cattle api listening");

  const adminAuthorizedKeys = loadAdminAuthorizedKeys({
    filePath: cfg.adminAuthorizedKeysFile,
    inline: cfg.adminAuthorizedKeysInline,
  });

  const rt: ClfWorkerRuntime = {
    hcloudToken: cfg.hcloudToken,
    cattle: {
      image: cfg.cattle.image,
      serverType: cfg.cattle.serverType,
      location: cfg.cattle.location,
      maxInstances: cfg.cattle.maxInstances,
      defaultTtl: cfg.cattle.defaultTtl,
      labels: parseCattleBaseLabels(cfg.cattle.labelsJson),
      defaultAutoShutdown: cfg.cattle.defaultAutoShutdown,
      secretsBaseUrl: cattleSecretsBaseUrl,
      bootstrapTtlMs: cfg.cattle.bootstrapTtlMs,
    },
    identitiesRoot: cfg.identitiesRoot,
    adminAuthorizedKeys,
    tailscaleAuthKey: cfg.tailscaleAuthKey,
    env: process.env,
  };

  const host = os.hostname();
  const pid = process.pid;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < cfg.workerConcurrency; i++) {
    const workerId = `clf-${host}-${pid}-${i}`;
    workers.push(
      runClfWorkerLoop({
        queue: q,
        workerId,
        pollMs: cfg.workerPollMs,
        leaseMs: cfg.workerLeaseMs,
        leaseRefreshMs: cfg.workerLeaseRefreshMs,
        runtime: rt,
        stopSignal,
      }),
    );
  }

  while (!stopSignal.stopped) {
    await new Promise((r) => setTimeout(r, 250));
  }

  await new Promise<void>((resolve) => cattleServer.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled(workers);
  q.close();
  console.log("clf-orchestrator: stopped");
}

main().catch(() => {
  console.error("clf-orchestrator: fatal error");
  process.exitCode = 1;
});
