export function migrateClfQueue(db: import("better-sqlite3").Database): void {
  let version = db.pragma("user_version", { simple: true }) as number;
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
    version = 1;
  }

  if (version === 1) {
    db.exec(`
      create table cattle_bootstrap_tokens (
        token_hash text primary key,
        created_at integer not null,
        expires_at integer not null,
        used_at integer,
        job_id text not null,
        requester text not null,
        cattle_name text not null,
        env_keys_json text not null,
        public_env_json text not null
      );
      create index cattle_bootstrap_tokens_by_expires_at on cattle_bootstrap_tokens(expires_at);
      create index cattle_bootstrap_tokens_by_job_id on cattle_bootstrap_tokens(job_id);
    `);
    db.pragma("user_version = 2");
    version = 2;
  }

  if (version === 2) {
    db.exec(`
      create index jobs_by_status_lease_until on jobs(status, lease_until);
    `);
    db.pragma("user_version = 3");
    version = 3;
  }

  if (version !== 3) throw new Error(`unsupported clf queue schema version: ${version}`);
}

