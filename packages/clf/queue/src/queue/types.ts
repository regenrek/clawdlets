export type ClfQueueJobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export type ClfQueueJob = {
  jobId: string;
  kind: string;
  payload: unknown;
  requester: string;
  idempotencyKey: string;
  status: ClfQueueJobStatus;
  priority: number;
  runAt: number; // unix ms
  createdAt: number; // unix ms
  updatedAt: number; // unix ms
  attempt: number;
  maxAttempts: number;
  lockedBy: string | null;
  leaseUntil: number | null; // unix ms
  lastError: string;
  result: unknown | null;
};

export type ClfQueueClaimedJob = {
  job: ClfQueueJob;
  workerId: string;
  leaseUntil: number;
};

export type ClfQueueFilters = {
  requester?: string;
  statuses?: ClfQueueJobStatus[];
  kinds?: string[];
  limit?: number;
};

export type ClfCattleBootstrapToken = {
  jobId: string;
  requester: string;
  cattleName: string;
  envKeys: string[];
  publicEnv: Record<string, string>;
  createdAt: number; // unix ms
  expiresAt: number; // unix ms
  usedAt: number | null; // unix ms
};

export type ClfQueue = {
  close(): void;

  enqueue(params: {
    kind: string;
    payload: unknown;
    requester: string;
    idempotencyKey?: string;
    runAt?: number; // unix ms
    priority?: number;
    maxAttempts?: number;
  }): { jobId: string; deduped: boolean };

  get(jobId: string): ClfQueueJob | null;
  list(filters?: ClfQueueFilters): ClfQueueJob[];

  claimNext(params: { workerId: string; now?: number; leaseMs?: number }): ClfQueueJob | null;
  extendLease(params: { jobId: string; workerId: string; leaseUntil: number }): boolean;

  ack(params: { jobId: string; workerId: string; now?: number; result?: unknown }): boolean;
  fail(params: {
    jobId: string;
    workerId: string;
    now?: number;
    error: string;
    retry?: { baseMs?: number; maxMs?: number };
  }): { status: "queued" | "failed" } | null;
  cancel(params: { jobId: string; now?: number }): boolean;

  prune(params: { now?: number; keepDays: number }): number;

  createCattleBootstrapToken(params: {
    jobId: string;
    requester: string;
    cattleName: string;
    envKeys: string[];
    publicEnv?: Record<string, string>;
    now?: number; // unix ms
    ttlMs?: number;
  }): { token: string; expiresAt: number };

  consumeCattleBootstrapToken(params: { token: string; now?: number }): ClfCattleBootstrapToken | null;

  pruneCattleBootstrapTokens(params: { now?: number }): number;
};

