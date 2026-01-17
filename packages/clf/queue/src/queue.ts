import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");

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
  fail(params: { jobId: string; workerId: string; now?: number; error: string; retry?: { baseMs?: number; maxMs?: number } }): { status: "queued" | "failed" } | null;
  cancel(params: { jobId: string; now?: number }): boolean;

  prune(params: { now?: number; keepDays: number }): number;
};

type JobRow = {
  job_id: string;
  kind: string;
  payload_json: string;
  requester: string;
  idempotency_key: string;
  status: ClfQueueJobStatus;
  priority: number;
  run_at: number;
  created_at: number;
  updated_at: number;
  attempt: number;
  max_attempts: number;
  locked_by: string | null;
  lease_until: number | null;
  last_error: string | null;
  result_json: string | null;
};

function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rowToJob(row: JobRow): ClfQueueJob {
  return {
    jobId: row.job_id,
    kind: row.kind,
    payload: safeParseJson(row.payload_json),
    requester: row.requester,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    priority: row.priority,
    runAt: row.run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    lockedBy: row.locked_by,
    leaseUntil: row.lease_until,
    lastError: String(row.last_error || ""),
    result: safeParseJson(row.result_json),
  };
}

function migrate(db: import("better-sqlite3").Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version === 0) {
    db.exec(`
      pragma foreign_keys = on;

      create table jobs (
        job_id text primary key,
        kind text not null,
        payload_json text not null,
        requester text not null,
        idempotency_key text not null,
        status text not null,
        priority integer not null,
        run_at integer not null,
        created_at integer not null,
        updated_at integer not null,
        attempt integer not null,
        max_attempts integer not null,
        locked_by text,
        lease_until integer,
        last_error text,
        result_json text
      );

      create unique index jobs_by_idempotency on jobs(requester, idempotency_key) where idempotency_key != '';
      create index jobs_by_status_run_at on jobs(status, run_at);
      create index jobs_by_requester on jobs(requester, created_at desc);
      create index jobs_by_kind on jobs(kind, created_at desc);

      create table job_events (
        id integer primary key autoincrement,
        job_id text not null,
        at integer not null,
        type text not null,
        message text not null,
        attempt integer not null,
        foreign key(job_id) references jobs(job_id) on delete cascade
      );
      create index job_events_by_job_id on job_events(job_id, at);
    `);
    db.pragma("user_version = 1");
    return;
  }

  if (version !== 1) throw new Error(`unsupported clf queue schema version: ${version}`);
}

function computeBackoffMs(params: { attempt: number; baseMs: number; maxMs: number }): number {
  const a = Math.max(1, Math.floor(params.attempt));
  const base = Math.max(1, Math.floor(params.baseMs));
  const max = Math.max(base, Math.floor(params.maxMs));
  const factor = 2 ** (a - 1);
  return Math.min(max, base * factor);
}

export function openClfQueue(dbPath: string): ClfQueue {
  const abs = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const db = new BetterSqlite3(abs);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  migrate(db);

  const insertJob = db.prepare(`
    insert into jobs (
      job_id, kind, payload_json,
      requester, idempotency_key,
      status, priority, run_at,
      created_at, updated_at,
      attempt, max_attempts,
      locked_by, lease_until,
      last_error, result_json
    )
    values (
      @job_id, @kind, @payload_json,
      @requester, @idempotency_key,
      @status, @priority, @run_at,
      @created_at, @updated_at,
      @attempt, @max_attempts,
      null, null,
      '', null
    )
  `);

  const findByIdempotency = db.prepare<{ requester: string; idempotency_key: string }, Pick<JobRow, "job_id">>(
    `select job_id from jobs where requester = @requester and idempotency_key = @idempotency_key limit 1`,
  );

  const getJob = db.prepare<{ job_id: string }, JobRow>(
    `select * from jobs where job_id = @job_id limit 1`,
  );

  const listJobsBase = (filters?: ClfQueueFilters): { sql: string; params: Record<string, unknown> } => {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.requester) {
      where.push("requester = @requester");
      params.requester = filters.requester;
    }
    if (filters?.statuses && filters.statuses.length > 0) {
      where.push(`status in (${filters.statuses.map((_, i) => `@s${i}`).join(",")})`);
      filters.statuses.forEach((s, i) => (params[`s${i}`] = s));
    }
    if (filters?.kinds && filters.kinds.length > 0) {
      where.push(`kind in (${filters.kinds.map((_, i) => `@k${i}`).join(",")})`);
      filters.kinds.forEach((k, i) => (params[`k${i}`] = k));
    }

    const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(500, Math.floor(filters?.limit ?? 50)));
    params.limit = limit;
    return {
      sql: `select * from jobs ${whereSql} order by created_at desc, job_id asc limit @limit`,
      params,
    };
  };

  const selectNext = db.prepare<{ now: number }, Pick<JobRow, "job_id">>(
    `
      select job_id
      from jobs
      where
        (status = 'queued' and run_at <= @now)
        or (status = 'running' and lease_until is not null and lease_until <= @now)
      order by priority desc, run_at asc, created_at asc, job_id asc
      limit 1
    `,
  );

  const claimJob = db.prepare<{ job_id: string; now: number; worker_id: string; lease_until: number }, { changes: number }>(
    `
      update jobs
      set
        status = 'running',
        locked_by = @worker_id,
        lease_until = @lease_until,
        updated_at = @now,
        attempt = attempt + 1
      where
        job_id = @job_id
        and (
          (status = 'queued' and run_at <= @now)
          or (status = 'running' and lease_until is not null and lease_until <= @now)
        )
    `,
  );

  const updateLease = db.prepare<{ job_id: string; worker_id: string; lease_until: number; now: number }, { changes: number }>(
    `
      update jobs
      set lease_until = @lease_until,
          updated_at = @now
      where job_id = @job_id
        and status = 'running'
        and locked_by = @worker_id
    `,
  );

  const ackJob = db.prepare<{ job_id: string; worker_id: string; now: number; result_json: string }, { changes: number }>(
    `
      update jobs
      set
        status = 'done',
        updated_at = @now,
        locked_by = null,
        lease_until = null,
        result_json = @result_json
      where job_id = @job_id
        and status = 'running'
        and locked_by = @worker_id
    `,
  );

  const failToRetry = db.prepare<{ job_id: string; worker_id: string; now: number; run_at: number; last_error: string }, { changes: number }>(
    `
      update jobs
      set
        status = 'queued',
        updated_at = @now,
        locked_by = null,
        lease_until = null,
        run_at = @run_at,
        last_error = @last_error
      where job_id = @job_id
        and status = 'running'
        and locked_by = @worker_id
    `,
  );

  const failTerminal = db.prepare<{ job_id: string; worker_id: string; now: number; last_error: string }, { changes: number }>(
    `
      update jobs
      set
        status = 'failed',
        updated_at = @now,
        locked_by = null,
        lease_until = null,
        last_error = @last_error
      where job_id = @job_id
        and status = 'running'
        and locked_by = @worker_id
    `,
  );

  const cancelJob = db.prepare<{ job_id: string; now: number }, { changes: number }>(
    `
      update jobs
      set
        status = 'canceled',
        updated_at = @now,
        locked_by = null,
        lease_until = null
      where job_id = @job_id
        and status in ('queued','running')
    `,
  );

  const insertEvent = db.prepare<{ job_id: string; at: number; type: string; message: string; attempt: number }>(
    `insert into job_events (job_id, at, type, message, attempt) values (@job_id, @at, @type, @message, @attempt)`,
  );

  const pruneJobs = db.prepare<{ cutoff: number }, { changes: number }>(
    `delete from jobs where created_at < @cutoff and status in ('done','failed','canceled')`,
  );

  const enqueueTx = db.transaction((params: {
    kind: string;
    payload: unknown;
    requester: string;
    idempotencyKey: string;
    runAt: number;
    priority: number;
    maxAttempts: number;
    now: number;
  }) => {
    if (params.idempotencyKey) {
      const existing = findByIdempotency.get({ requester: params.requester, idempotency_key: params.idempotencyKey });
      if (existing?.job_id) return { jobId: existing.job_id, deduped: true };
    }

    const jobId = randomUUID();
    insertJob.run({
      job_id: jobId,
      kind: params.kind,
      payload_json: JSON.stringify(params.payload ?? null),
      requester: params.requester,
      idempotency_key: params.idempotencyKey,
      status: "queued",
      priority: params.priority,
      run_at: params.runAt,
      created_at: params.now,
      updated_at: params.now,
      attempt: 0,
      max_attempts: params.maxAttempts,
    });
    insertEvent.run({ job_id: jobId, at: params.now, type: "enqueue", message: "", attempt: 0 });
    return { jobId, deduped: false };
  });

  const claimTx = db.transaction((params: { workerId: string; now: number; leaseMs: number }) => {
    const picked = selectNext.get({ now: params.now });
    if (!picked?.job_id) return null;
    const leaseUntil = params.now + params.leaseMs;
    const res = claimJob.run({ job_id: picked.job_id, now: params.now, worker_id: params.workerId, lease_until: leaseUntil });
    if (res.changes !== 1) return null;
    const row = getJob.get({ job_id: picked.job_id });
    if (!row) return null;
    insertEvent.run({ job_id: picked.job_id, at: params.now, type: "claim", message: params.workerId, attempt: row.attempt });
    return rowToJob(row);
  });

  return {
    close: () => db.close(),

    enqueue: (params) => {
      const kind = String(params.kind || "").trim();
      if (!kind) throw new Error("enqueue.kind missing");
      const requester = String(params.requester || "").trim();
      if (!requester) throw new Error("enqueue.requester missing");
      const idempotencyKey = String(params.idempotencyKey || "").trim();
      const now = Date.now();
      const runAt = Number.isFinite(params.runAt) && (params.runAt as number) > 0 ? Math.floor(params.runAt as number) : now;
      const priority = Number.isFinite(params.priority) ? Math.floor(params.priority as number) : 0;
      const maxAttempts = Number.isFinite(params.maxAttempts) && (params.maxAttempts as number) > 0 ? Math.floor(params.maxAttempts as number) : 1;
      return enqueueTx({ kind, payload: params.payload ?? null, requester, idempotencyKey, runAt, priority, maxAttempts, now });
    },

    get: (jobId) => {
      const v = String(jobId || "").trim();
      if (!v) return null;
      const row = getJob.get({ job_id: v });
      return row ? rowToJob(row) : null;
    },

    list: (filters) => {
      const { sql, params } = listJobsBase(filters);
      const stmt = db.prepare<Record<string, unknown>, JobRow>(sql);
      return stmt.all(params).map(rowToJob);
    },

    claimNext: (params) => {
      const workerId = String(params.workerId || "").trim();
      if (!workerId) throw new Error("claimNext.workerId missing");
      const now = params.now ?? Date.now();
      const leaseMs = Math.max(5_000, Math.min(60 * 60_000, Math.floor(params.leaseMs ?? 120_000)));
      return claimTx({ workerId, now, leaseMs });
    },

    extendLease: (params) => {
      const jobId = String(params.jobId || "").trim();
      const workerId = String(params.workerId || "").trim();
      if (!jobId || !workerId) return false;
      const now = Date.now();
      const res = updateLease.run({ job_id: jobId, worker_id: workerId, lease_until: params.leaseUntil, now });
      return res.changes === 1;
    },

    ack: (params) => {
      const jobId = String(params.jobId || "").trim();
      const workerId = String(params.workerId || "").trim();
      if (!jobId || !workerId) return false;
      const now = params.now ?? Date.now();
      const res = ackJob.run({ job_id: jobId, worker_id: workerId, now, result_json: JSON.stringify(params.result ?? null) });
      if (res.changes === 1) insertEvent.run({ job_id: jobId, at: now, type: "ack", message: "", attempt: 0 });
      return res.changes === 1;
    },

    fail: (params) => {
      const jobId = String(params.jobId || "").trim();
      const workerId = String(params.workerId || "").trim();
      if (!jobId || !workerId) return null;
      const now = params.now ?? Date.now();
      const row = getJob.get({ job_id: jobId });
      if (!row) return null;
      const err = String(params.error || "").trim() || "unknown error";

      const attempt = Math.max(1, row.attempt);
      const maxAttempts = Math.max(1, row.max_attempts);
      if (attempt < maxAttempts) {
        const baseMs = params.retry?.baseMs ?? 5_000;
        const maxMs = params.retry?.maxMs ?? 5 * 60_000;
        const delay = computeBackoffMs({ attempt, baseMs, maxMs });
        const res = failToRetry.run({ job_id: jobId, worker_id: workerId, now, run_at: now + delay, last_error: err });
        if (res.changes === 1) {
          insertEvent.run({ job_id: jobId, at: now, type: "retry", message: err, attempt });
          return { status: "queued" };
        }
        return null;
      }

      const res = failTerminal.run({ job_id: jobId, worker_id: workerId, now, last_error: err });
      if (res.changes === 1) {
        insertEvent.run({ job_id: jobId, at: now, type: "fail", message: err, attempt });
        return { status: "failed" };
      }
      return null;
    },

    cancel: (params) => {
      const jobId = String(params.jobId || "").trim();
      if (!jobId) return false;
      const now = params.now ?? Date.now();
      const res = cancelJob.run({ job_id: jobId, now });
      if (res.changes === 1) insertEvent.run({ job_id: jobId, at: now, type: "cancel", message: "", attempt: 0 });
      return res.changes === 1;
    },

    prune: (params) => {
      const now = params.now ?? Date.now();
      const keepDays = Math.max(1, Math.floor(params.keepDays));
      const cutoff = now - keepDays * 86400_000;
      const res = pruneJobs.run({ cutoff });
      return res.changes;
    },
  };
}

