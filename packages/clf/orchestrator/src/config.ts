function parseIntEnv(value: string | undefined, fallback: number): number {
  const v = String(value ?? "").trim();
  if (!v) return fallback;
  if (!/^-?\d+$/.test(v)) throw new Error(`invalid int env value: ${v}`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`invalid int env value: ${v}`);
  return n;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  throw new Error(`invalid bool env value: ${v}`);
}

function parseStringEnv(value: string | undefined, fallback: string): string {
  const v = String(value ?? "").trim();
  return v || fallback;
}

export type ClfOrchestratorConfig = {
  dbPath: string;
  socketPath: string;

  workerConcurrency: number;
  workerPollMs: number;
  workerLeaseMs: number;
  workerLeaseRefreshMs: number;

  hcloudToken: string;

  cattle: {
    image: string;
    serverType: string;
    location: string;
    maxInstances: number;
    defaultTtl: string;
    labelsJson: string;
    defaultAutoShutdown: boolean;
    secretsListenHost: string;
    secretsListenPort: number;
    secretsBaseUrl: string;
    bootstrapTtlMs: number;
  };

  identitiesRoot: string;
  adminAuthorizedKeysFile: string;
  adminAuthorizedKeysInline: string;
  tailscaleAuthKey: string;
};

export function loadClfOrchestratorConfigFromEnv(env: NodeJS.ProcessEnv): ClfOrchestratorConfig {
  const dbPath = parseStringEnv(env.CLF_DB_PATH, "/var/lib/clf/orchestrator/state.sqlite");
  const socketPath = parseStringEnv(env.CLF_SOCKET_PATH, "/run/clf/orchestrator.sock");

  const workerConcurrency = Math.max(1, Math.min(64, parseIntEnv(env.CLF_WORKER_CONCURRENCY, 2)));
  const workerPollMs = Math.max(200, Math.min(30_000, parseIntEnv(env.CLF_WORKER_POLL_MS, 1_000)));
  const workerLeaseMs = Math.max(30_000, Math.min(60 * 60_000, parseIntEnv(env.CLF_WORKER_LEASE_MS, 10 * 60_000)));
  const workerLeaseRefreshMs = Math.max(5_000, Math.min(workerLeaseMs / 2, parseIntEnv(env.CLF_WORKER_LEASE_REFRESH_MS, 30_000)));

  const hcloudToken = String(env.HCLOUD_TOKEN || "").trim();
  if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN");

  const tailscaleAuthKey = String(env.TAILSCALE_AUTH_KEY || env.CLF_TAILSCALE_AUTH_KEY || "").trim();
  if (!tailscaleAuthKey) throw new Error("missing TAILSCALE_AUTH_KEY");

  const image = String(env.CLF_CATTLE_IMAGE || "").trim();
  if (!image) throw new Error("missing CLF_CATTLE_IMAGE");

  const identitiesRoot = parseStringEnv(env.CLF_IDENTITIES_ROOT, "/var/lib/clf/identities");
  const adminAuthorizedKeysFile = parseStringEnv(env.CLF_ADMIN_AUTHORIZED_KEYS_FILE, "");
  const adminAuthorizedKeysInline = parseStringEnv(env.CLF_ADMIN_AUTHORIZED_KEYS, "");

  const secretsBaseUrl = parseStringEnv(env.CLF_CATTLE_SECRETS_BASE_URL, "");
  if (secretsBaseUrl && !/^https?:\/\//.test(secretsBaseUrl)) {
    throw new Error(`invalid CLF_CATTLE_SECRETS_BASE_URL (expected http(s)): ${secretsBaseUrl}`);
  }

  return {
    dbPath,
    socketPath,

    workerConcurrency,
    workerPollMs,
    workerLeaseMs,
    workerLeaseRefreshMs,

    hcloudToken,

    cattle: {
      image,
      serverType: parseStringEnv(env.CLF_CATTLE_SERVER_TYPE, "cx22"),
      location: parseStringEnv(env.CLF_CATTLE_LOCATION, "nbg1"),
      maxInstances: Math.max(1, Math.min(1000, parseIntEnv(env.CLF_CATTLE_MAX_INSTANCES, 10))),
      defaultTtl: parseStringEnv(env.CLF_CATTLE_DEFAULT_TTL, "2h"),
      labelsJson: parseStringEnv(env.CLF_CATTLE_LABELS_JSON, "{}"),
      defaultAutoShutdown: parseBoolEnv(env.CLF_CATTLE_AUTO_SHUTDOWN, true),
      secretsListenHost: parseStringEnv(env.CLF_CATTLE_SECRETS_LISTEN_HOST, "auto"),
      secretsListenPort: Math.max(1, Math.min(65535, parseIntEnv(env.CLF_CATTLE_SECRETS_LISTEN_PORT, 18337))),
      secretsBaseUrl,
      bootstrapTtlMs: Math.max(30_000, Math.min(60 * 60_000, parseIntEnv(env.CLF_CATTLE_BOOTSTRAP_TTL_MS, 5 * 60_000))),
    },

    identitiesRoot,
    adminAuthorizedKeysFile,
    adminAuthorizedKeysInline,
    tailscaleAuthKey,
  };
}
