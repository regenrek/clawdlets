import path from "node:path";
import { createRequire } from "node:module";
import { ensurePrivateDir, ensurePrivateFile } from "./fs-private.js";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");

export type CattleStateServer = {
  id: string;
  name: string;
  identity: string;
  task: string;
  taskId: string;
  ttlSeconds: number;
  createdAt: number; // unix seconds
  expiresAt: number; // unix seconds
  labels: Record<string, string>;
  lastStatus: string;
  lastIpv4: string;
  deletedAt: number | null; // unix seconds
};

type ServerRow = {
  id: string;
  name: string;
  identity: string;
  task: string;
  task_id: string;
  ttl_seconds: number;
  created_at: number;
  expires_at: number;
  labels_json: string;
  last_status: string;
  last_ipv4: string;
  deleted_at: number | null;
};

export type CattleState = {
  close(): void;
  upsertServer(server: Omit<CattleStateServer, "deletedAt"> & { deletedAt?: number | null }): void;
  markDeletedById(id: string, deletedAt: number): void;
  listActive(): CattleStateServer[];
  findActiveByIdOrName(idOrName: string): CattleStateServer | null;
};

function rowToServer(row: ServerRow): CattleStateServer {
  let labels: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.labels_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) labels = parsed as Record<string, string>;
  } catch {
    labels = {};
  }

  return {
    id: row.id,
    name: row.name,
    identity: row.identity,
    task: row.task,
    taskId: row.task_id,
    ttlSeconds: row.ttl_seconds,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    labels,
    lastStatus: row.last_status,
    lastIpv4: row.last_ipv4,
    deletedAt: row.deleted_at,
  };
}

function migrate(db: import("better-sqlite3").Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;

  if (version === 0) {
    db.exec(`
      create table servers (
        id text primary key,
        name text not null,
        identity text not null,
        task text not null,
        task_id text not null,
        ttl_seconds integer not null,
        created_at integer not null,
        expires_at integer not null,
        labels_json text not null,
        last_status text not null,
        last_ipv4 text not null,
        deleted_at integer
      );
      create index servers_by_name on servers(name);
      create index servers_by_deleted_at on servers(deleted_at);
    `);
    db.pragma("user_version = 1");
    return;
  }

  if (version !== 1) {
    throw new Error(`unsupported cattle state schema version: ${version}`);
  }
}

export function openCattleState(dbPath: string): CattleState {
  const abs = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
  ensurePrivateDir(path.dirname(abs));

  const db = new BetterSqlite3(abs);
  ensurePrivateFile(abs);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  migrate(db);

  const upsert = db.prepare(`
    insert into servers (
      id, name, identity, task, task_id,
      ttl_seconds, created_at, expires_at,
      labels_json, last_status, last_ipv4, deleted_at
    )
    values (
      @id, @name, @identity, @task, @task_id,
      @ttl_seconds, @created_at, @expires_at,
      @labels_json, @last_status, @last_ipv4, @deleted_at
    )
    on conflict(id) do update set
      name = excluded.name,
      identity = excluded.identity,
      task = excluded.task,
      task_id = excluded.task_id,
      ttl_seconds = excluded.ttl_seconds,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      labels_json = excluded.labels_json,
      last_status = excluded.last_status,
      last_ipv4 = excluded.last_ipv4,
      deleted_at = excluded.deleted_at
  `);

  const markDeleted = db.prepare(`update servers set deleted_at = @deleted_at where id = @id`);

  const listActive = db.prepare<never[], ServerRow>(`select * from servers where deleted_at is null order by created_at desc`);
  const findById = db.prepare<{ id: string }, ServerRow>(`select * from servers where deleted_at is null and id = @id limit 1`);
  const findByName = db.prepare<{ name: string }, ServerRow>(`select * from servers where deleted_at is null and name = @name limit 1`);

  return {
    close: () => db.close(),

    upsertServer: (server) => {
      upsert.run({
        id: server.id,
        name: server.name,
        identity: server.identity,
        task: server.task,
        task_id: server.taskId,
        ttl_seconds: server.ttlSeconds,
        created_at: server.createdAt,
        expires_at: server.expiresAt,
        labels_json: JSON.stringify(server.labels || {}),
        last_status: server.lastStatus || "",
        last_ipv4: server.lastIpv4 || "",
        deleted_at: server.deletedAt ?? null,
      });
    },

    markDeletedById: (id, deletedAt) => {
      markDeleted.run({ id: String(id || "").trim(), deleted_at: deletedAt });
    },

    listActive: () => listActive.all().map(rowToServer),

    findActiveByIdOrName: (idOrName: string) => {
      const v = String(idOrName || "").trim();
      if (!v) return null;
      const byId = findById.get({ id: v });
      if (byId) return rowToServer(byId);
      const byName = findByName.get({ name: v });
      if (byName) return rowToServer(byName);
      return null;
    },
  };
}
