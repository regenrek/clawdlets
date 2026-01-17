import fs from "node:fs";
import { type ClfQueue } from "@clawdlets/clf-queue";
import { parseClfJobPayload } from "@clawdlets/clf-queue";
import { buildCattleCloudInitUserData } from "@clawdlets/core/lib/cattle-cloudinit";
import { parseTtlToSeconds } from "@clawdlets/core/lib/ttl";
import { getModelRequiredEnvVars } from "@clawdlets/core/lib/llm-provider-env";
import { loadIdentity } from "@clawdlets/core/lib/identity-loader";
import {
  createCattleServer,
  listCattleServers,
  reapExpiredCattle,
  type CattleServer,
  CATTLE_LABEL_CATTLE,
  CATTLE_LABEL_CATTLE_VALUE,
  CATTLE_LABEL_CREATED_AT,
  CATTLE_LABEL_EXPIRES_AT,
  CATTLE_LABEL_IDENTITY,
  CATTLE_LABEL_MANAGED_BY,
  CATTLE_LABEL_MANAGED_BY_VALUE,
  CATTLE_LABEL_TASK_ID,
} from "@clawdlets/core/lib/hcloud-cattle";
import { buildCattleServerName, safeCattleLabelValue } from "@clawdlets/core/lib/cattle-planner";

export type ClfWorkerRuntime = {
  hcloudToken: string;
  cattle: {
    image: string;
    serverType: string;
    location: string;
    maxInstances: number;
    defaultTtl: string;
    labels: Record<string, string>;
    defaultAutoShutdown: boolean;
    secretsBaseUrl: string;
    bootstrapTtlMs: number;
  };
  identitiesRoot: string;
  adminAuthorizedKeys: string[];
  tailscaleAuthKey: string;
  env: NodeJS.ProcessEnv;
};

function unixSecondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

class Mutex {
  private chain: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const spawnMutex = new Mutex();

function parseLabelsJson(raw: string): Record<string, string> {
  const v = String(raw || "").trim();
  if (!v) return {};
  try {
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, string>;
  } catch {
    // ignore
  }
  return {};
}

function requireTtlSeconds(ttlRaw: string): number {
  const parsed = parseTtlToSeconds(ttlRaw);
  if (!parsed) throw new Error(`invalid ttl: ${ttlRaw}`);
  return parsed.seconds;
}

function requiredEnvKeysForModel(params: { env: NodeJS.ProcessEnv; model: string }): string[] {
  const required = getModelRequiredEnvVars(params.model);
  if (required.length === 0) throw new Error(`unknown model provider env requirements: ${params.model}`);
  for (const k of required) {
    const v = String(params.env[k] || "").trim();
    if (!v) throw new Error(`missing required env var for model ${params.model}: ${k}`);
  }
  return required;
}

async function handleCattleSpawn(params: {
  worker: string;
  jobId: string;
  requester: string;
  payload: unknown;
  rt: ClfWorkerRuntime;
  queue: ClfQueue;
}): Promise<{ server: CattleServer }> {
  const p = parseClfJobPayload("cattle.spawn", params.payload);

  const identity = loadIdentity({ repoRoot: "/", identityName: p.identity, identitiesRoot: params.rt.identitiesRoot });
  const model = String(identity.config.model.primary || "").trim();
  if (!model) throw new Error(`identity missing model.primary: ${identity.name}`);

  const ttlSeconds = requireTtlSeconds(String(p.ttl || params.rt.cattle.defaultTtl || "").trim());
  const createdAt = unixSecondsNow();
  const expiresAt = createdAt + ttlSeconds;

  const autoShutdown = p.autoShutdown ?? params.rt.cattle.defaultAutoShutdown;
  const publicEnv: Record<string, string> = {};
  if (!autoShutdown) publicEnv["CLAWDLETS_CATTLE_AUTO_SHUTDOWN"] = "0";

  return await spawnMutex.runExclusive(async () => {
    const existing = await listCattleServers({ token: params.rt.hcloudToken });
    if (existing.length >= params.rt.cattle.maxInstances) {
      throw new Error(`maxInstances reached (${existing.length}/${params.rt.cattle.maxInstances})`);
    }

    const name = buildCattleServerName(identity.name, createdAt);

    const envKeys = requiredEnvKeysForModel({ env: params.rt.env, model });
    if (params.rt.env.GITHUB_TOKEN) envKeys.push("GITHUB_TOKEN");

    const bootstrap = params.queue.createCattleBootstrapToken({
      jobId: params.jobId,
      requester: params.requester,
      cattleName: name,
      envKeys,
      publicEnv,
      ttlMs: params.rt.cattle.bootstrapTtlMs,
    });

    const userData = buildCattleCloudInitUserData({
      hostname: name,
      adminAuthorizedKeys: params.rt.adminAuthorizedKeys,
      tailscaleAuthKey: params.rt.tailscaleAuthKey,
      task: p.task,
      publicEnv,
      secretsBootstrap: { baseUrl: params.rt.cattle.secretsBaseUrl, token: bootstrap.token },
      extraWriteFiles: identity.cloudInitFiles,
    });

    const labels: Record<string, string> = {
      ...params.rt.cattle.labels,
      [CATTLE_LABEL_MANAGED_BY]: CATTLE_LABEL_MANAGED_BY_VALUE,
      [CATTLE_LABEL_CATTLE]: CATTLE_LABEL_CATTLE_VALUE,
      [CATTLE_LABEL_IDENTITY]: safeCattleLabelValue(identity.name, "id"),
      [CATTLE_LABEL_TASK_ID]: safeCattleLabelValue(p.task.taskId, "task"),
      [CATTLE_LABEL_CREATED_AT]: String(createdAt),
      [CATTLE_LABEL_EXPIRES_AT]: String(expiresAt),
    };

    const server = await createCattleServer({
      token: params.rt.hcloudToken,
      name,
      image: String(p.image || params.rt.cattle.image || "").trim(),
      serverType: String(p.serverType || params.rt.cattle.serverType || "").trim(),
      location: String(p.location || params.rt.cattle.location || "").trim(),
      userData,
      labels,
    });

    return { server };
  });

}

async function handleCattleReap(params: { payload: unknown; rt: ClfWorkerRuntime }): Promise<{ deletedIds: string[] }> {
  const p = parseClfJobPayload("cattle.reap", params.payload);
  const res = await reapExpiredCattle({ token: params.rt.hcloudToken, dryRun: p.dryRun });
  return { deletedIds: res.deletedIds };
}

export async function runClfWorkerLoop(params: {
  queue: ClfQueue;
  workerId: string;
  pollMs: number;
  leaseMs: number;
  leaseRefreshMs: number;
  runtime: ClfWorkerRuntime;
  stopSignal: { stopped: boolean };
}): Promise<void> {
  const q = params.queue;

  while (!params.stopSignal.stopped) {
    const job = q.claimNext({ workerId: params.workerId, leaseMs: params.leaseMs });
    if (!job) {
      await new Promise((r) => setTimeout(r, params.pollMs));
      continue;
    }

    const hb = setInterval(() => {
      q.extendLease({ jobId: job.jobId, workerId: params.workerId, leaseUntil: Date.now() + params.leaseMs });
    }, params.leaseRefreshMs);

    try {
      if (job.kind === "cattle.spawn") {
        const out = await handleCattleSpawn({
          worker: params.workerId,
          jobId: job.jobId,
          requester: job.requester,
          payload: job.payload,
          rt: params.runtime,
          queue: q,
        });
        q.ack({ jobId: job.jobId, workerId: params.workerId, result: out });
      } else if (job.kind === "cattle.reap") {
        const out = await handleCattleReap({ payload: job.payload, rt: params.runtime });
        q.ack({ jobId: job.jobId, workerId: params.workerId, result: out });
      } else {
        q.fail({ jobId: job.jobId, workerId: params.workerId, error: `unsupported job kind: ${job.kind}` });
      }
    } catch (e) {
      q.fail({ jobId: job.jobId, workerId: params.workerId, error: String((e as Error)?.message || e) });
    } finally {
      clearInterval(hb);
    }
  }
}

export function loadAdminAuthorizedKeys(params: { filePath: string; inline: string }): string[] {
  if (params.filePath) {
    const raw = fs.readFileSync(params.filePath, "utf8");
    return raw
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l && !l.startsWith("#"));
  }
  if (params.inline) {
    return params.inline
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }
  throw new Error("missing admin authorized keys (set CLF_ADMIN_AUTHORIZED_KEYS_FILE or CLF_ADMIN_AUTHORIZED_KEYS)");
}

export function parseCattleBaseLabels(labelsJson: string): Record<string, string> {
  return parseLabelsJson(labelsJson);
}
