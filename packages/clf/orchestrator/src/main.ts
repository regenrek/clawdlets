#!/usr/bin/env node
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { openClfQueue } from "@clawdlets/clf-queue";
import { loadClfOrchestratorConfigFromEnv } from "./config.js";
import { createOrchestratorHttpServer } from "./http.js";
import { loadAdminAuthorizedKeys, parseCattleBaseLabels, runClfWorkerLoop, type ClfWorkerRuntime } from "./worker.js";

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

async function main(): Promise<void> {
  const cfg = loadClfOrchestratorConfigFromEnv(process.env);

  const q = openClfQueue(cfg.dbPath);
  const server = createOrchestratorHttpServer({ queue: q });

  const stopSignal = { stopped: false };
  const stop = () => {
    stopSignal.stopped = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await listenHttpServer(server, cfg.socketPath);
  console.log(`clf-orchestrator: listening (socket=${cfg.socketPath})`);

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

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled(workers);
  q.close();
  console.log("clf-orchestrator: stopped");
}

main().catch((e) => {
  console.error(String((e as Error)?.message || e));
  process.exitCode = 1;
});

