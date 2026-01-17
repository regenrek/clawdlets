import { createHcloudServer, deleteHcloudServer, ensureHcloudFirewallId, listHcloudServers, waitForHcloudServerStatus, HcloudHttpError, type HcloudFirewallRule, type HcloudServer } from "./hcloud.js";

export type CattleServerStatus = "running" | "starting" | "stopping" | "off" | "unknown";

export interface CattleServer {
  id: string;
  name: string;
  identity: string;
  taskId: string;
  ttlSeconds: number;
  createdAt: Date;
  expiresAt: Date;
  ipv4: string;
  status: CattleServerStatus;
  labels: Record<string, string>;
}

export const CATTLE_LABEL_MANAGED_BY = "managed-by";
export const CATTLE_LABEL_MANAGED_BY_VALUE = "clawdlets";
export const CATTLE_LABEL_CATTLE = "cattle";
export const CATTLE_LABEL_CATTLE_VALUE = "true";
export const CATTLE_LABEL_IDENTITY = "identity";
export const CATTLE_LABEL_TASK_ID = "task-id";
export const CATTLE_LABEL_EXPIRES_AT = "expires-at";
export const CATTLE_LABEL_CREATED_AT = "created-at";

export function buildCattleLabelSelector(extra: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    [CATTLE_LABEL_MANAGED_BY]: CATTLE_LABEL_MANAGED_BY_VALUE,
    [CATTLE_LABEL_CATTLE]: CATTLE_LABEL_CATTLE_VALUE,
    ...extra,
  };

  const parts: string[] = [];
  for (const [k, v] of Object.entries(base)) {
    const kk = String(k || "").trim();
    const vv = String(v ?? "").trim();
    if (!kk || !vv) continue;
    parts.push(`${kk}=${vv}`);
  }
  return parts.join(",");
}

function mapStatus(status: string): CattleServerStatus {
  const s = status.toLowerCase();
  if (s === "running") return "running";
  if (s === "starting" || s === "initializing") return "starting";
  if (s === "stopping" || s === "deleting") return "stopping";
  if (s === "off") return "off";
  return "unknown";
}

function parseUnixSeconds(value: string | undefined | null): number | null {
  const s = String(value ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toCattleServer(server: HcloudServer): CattleServer {
  const labels = server.labels || {};
  const createdAt = labels[CATTLE_LABEL_CREATED_AT]
    ? new Date((parseUnixSeconds(labels[CATTLE_LABEL_CREATED_AT]) || 0) * 1000)
    : new Date(server.created);
  const expiresAt = labels[CATTLE_LABEL_EXPIRES_AT]
    ? new Date((parseUnixSeconds(labels[CATTLE_LABEL_EXPIRES_AT]) || 0) * 1000)
    : new Date(0);
  const ttlSeconds = Math.max(0, Math.floor((expiresAt.getTime() - createdAt.getTime()) / 1000));

  return {
    id: String(server.id),
    name: server.name,
    identity: String(labels[CATTLE_LABEL_IDENTITY] || ""),
    taskId: String(labels[CATTLE_LABEL_TASK_ID] || ""),
    ttlSeconds,
    createdAt,
    expiresAt,
    ipv4: String(server.public_net?.ipv4?.ip || ""),
    status: mapStatus(String(server.status || "")),
    labels,
  };
}

export async function createCattleServer(opts: {
  token: string;
  name: string;
  image: string;
  serverType: string;
  location: string;
  userData: string;
  labels: Record<string, string>;
}): Promise<CattleServer> {
  const fwRules: HcloudFirewallRule[] = [
    {
      direction: "in",
      protocol: "udp",
      port: "41641",
      source_ips: ["0.0.0.0/0", "::/0"],
      description: "Tailscale WireGuard UDP (direct connections)",
    },
  ];
  const firewallId = await ensureHcloudFirewallId({
    token: opts.token,
    name: "clawdlets-cattle-base",
    rules: fwRules,
    labels: { [CATTLE_LABEL_MANAGED_BY]: CATTLE_LABEL_MANAGED_BY_VALUE, [CATTLE_LABEL_CATTLE]: CATTLE_LABEL_CATTLE_VALUE },
  });

  const server = await createHcloudServer({
    token: opts.token,
    name: opts.name,
    serverType: opts.serverType,
    image: opts.image,
    location: opts.location,
    userData: opts.userData,
    labels: opts.labels,
    firewallIds: [firewallId],
  });

  const ready = await waitForHcloudServerStatus({
    token: opts.token,
    id: String(server.id),
    want: (status) => status.toLowerCase() === "running",
  });

  return toCattleServer(ready);
}

export async function destroyCattleServer(params: { token: string; id: string }): Promise<void> {
  await deleteHcloudServer({ token: params.token, id: params.id });
}

export async function listCattleServers(params: { token: string; labelSelector?: string }): Promise<CattleServer[]> {
  const servers = await listHcloudServers({ token: params.token, labelSelector: params.labelSelector || buildCattleLabelSelector() });
  return servers.map(toCattleServer);
}

export type ReapExpiredCattleResult = { expired: CattleServer[]; deletedIds: string[] };

export async function listExpiredCattle(params: { token: string; now?: Date; labelSelector?: string }): Promise<CattleServer[]> {
  const now = params.now ?? new Date();
  const servers = await listCattleServers({ token: params.token, labelSelector: params.labelSelector });
  return servers
    .filter((s) => Number.isFinite(s.expiresAt.getTime()) && s.expiresAt.getTime() > 0 && s.expiresAt.getTime() <= now.getTime())
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
}

export async function reapExpiredCattle(params: {
  token: string;
  now?: Date;
  labelSelector?: string;
  dryRun?: boolean;
  concurrency?: number;
}): Promise<ReapExpiredCattleResult> {
  const expired = await listExpiredCattle({ token: params.token, now: params.now, labelSelector: params.labelSelector });
  if (params.dryRun) return { expired, deletedIds: [] };

  const sleepMs = async (ms: number) => await new Promise((r) => setTimeout(r, ms));

  const destroyWithRetry = async (id: string) => {
    const maxAttempts = 4;
    let delayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await destroyCattleServer({ token: params.token, id });
        return;
      } catch (e) {
        const status = e instanceof HcloudHttpError ? e.status : 0;
        const retryable = status === 0 || status === 429 || (status >= 500 && status <= 599);
        if (!retryable || attempt === maxAttempts) throw e;
        await sleepMs(delayMs);
        delayMs = Math.min(delayMs * 2, 5_000);
      }
    }
  };

  const concurrency = Math.max(1, Math.min(10, Math.floor(params.concurrency ?? 4)));
  const queue = [...expired];
  const deleted = new Set<string>();

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const s = queue.shift();
      if (!s) return;
      await destroyWithRetry(s.id);
      deleted.add(s.id);
    }
  });

  await Promise.all(workers);

  const deletedIds = expired.filter((s) => deleted.has(s.id)).map((s) => s.id);

  return { expired, deletedIds };
}
