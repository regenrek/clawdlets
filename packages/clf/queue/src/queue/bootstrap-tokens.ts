import { randomBytes } from "node:crypto";
import type { ClfCattleBootstrapToken, ClfQueue } from "./types.js";
import { isSafeEnvVarName, safeParseJson, sha256Hex } from "./util.js";

type BootstrapTokenRow = {
  token_hash: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  job_id: string;
  requester: string;
  cattle_name: string;
  env_keys_json: string;
  public_env_json: string;
};

export function createBootstrapTokenOps(db: import("better-sqlite3").Database): Pick<
  ClfQueue,
  "createCattleBootstrapToken" | "consumeCattleBootstrapToken" | "pruneCattleBootstrapTokens"
> {
  const insertBootstrapToken = db.prepare<{
    token_hash: string;
    created_at: number;
    expires_at: number;
    job_id: string;
    requester: string;
    cattle_name: string;
    env_keys_json: string;
    public_env_json: string;
  }>(
    `
      insert into cattle_bootstrap_tokens (
        token_hash, created_at, expires_at, used_at,
        job_id, requester, cattle_name,
        env_keys_json, public_env_json
      )
      values (
        @token_hash, @created_at, @expires_at, null,
        @job_id, @requester, @cattle_name,
        @env_keys_json, @public_env_json
      )
    `,
  );

  const getBootstrapToken = db.prepare<{ token_hash: string }, BootstrapTokenRow>(
    `select * from cattle_bootstrap_tokens where token_hash = @token_hash limit 1`,
  );

  const markBootstrapTokenUsed = db.prepare<{ token_hash: string; now: number }, { changes: number }>(
    `
      update cattle_bootstrap_tokens
      set used_at = @now
      where token_hash = @token_hash
        and used_at is null
        and expires_at > @now
    `,
  );

  const pruneBootstrapTokens = db.prepare<{ now: number }, { changes: number }>(
    `delete from cattle_bootstrap_tokens where expires_at <= @now or used_at is not null`,
  );

  const createBootstrapTokenTx = db.transaction((params: {
    jobId: string;
    requester: string;
    cattleName: string;
    envKeys: string[];
    publicEnv: Record<string, string>;
    now: number;
    ttlMs: number;
  }) => {
    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const expiresAt = params.now + params.ttlMs;

    insertBootstrapToken.run({
      token_hash: tokenHash,
      created_at: params.now,
      expires_at: expiresAt,
      job_id: params.jobId,
      requester: params.requester,
      cattle_name: params.cattleName,
      env_keys_json: JSON.stringify(params.envKeys),
      public_env_json: JSON.stringify(params.publicEnv),
    });

    return { token, expiresAt };
  });

  const consumeBootstrapTokenTx = db.transaction((params: { tokenHash: string; now: number }) => {
    const row = getBootstrapToken.get({ token_hash: params.tokenHash });
    if (!row) return null;
    if (row.used_at != null) return null;
    if (row.expires_at <= params.now) return null;

    const res = markBootstrapTokenUsed.run({ token_hash: params.tokenHash, now: params.now });
    if (res.changes !== 1) return null;

    const envKeys = safeParseJson(row.env_keys_json);
    const publicEnv = safeParseJson(row.public_env_json);

    return {
      jobId: row.job_id,
      requester: row.requester,
      cattleName: row.cattle_name,
      envKeys: Array.isArray(envKeys) ? (envKeys as unknown[]).map((v) => String(v || "").trim()).filter(Boolean) : [],
      publicEnv: publicEnv && typeof publicEnv === "object" && !Array.isArray(publicEnv) ? (publicEnv as Record<string, string>) : {},
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: params.now,
    } satisfies ClfCattleBootstrapToken;
  });

  return {
    createCattleBootstrapToken: (params) => {
      const jobId = String(params.jobId || "").trim();
      if (!jobId) throw new Error("createCattleBootstrapToken.jobId missing");
      const requester = String(params.requester || "").trim();
      if (!requester) throw new Error("createCattleBootstrapToken.requester missing");
      const cattleName = String(params.cattleName || "").trim();
      if (!cattleName) throw new Error("createCattleBootstrapToken.cattleName missing");

      const envKeys = Array.from(new Set((params.envKeys || []).map((k) => String(k || "").trim()).filter(Boolean)));
      for (const k of envKeys) {
        if (!isSafeEnvVarName(k)) throw new Error(`createCattleBootstrapToken.envKeys contains invalid env var name: ${k}`);
      }
      const publicEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(params.publicEnv || {})) {
        const key = String(k || "").trim();
        if (!key) continue;
        if (!isSafeEnvVarName(key)) throw new Error(`createCattleBootstrapToken.publicEnv contains invalid env var name: ${key}`);
        if (!key.startsWith("CLAWDLETS_")) {
          throw new Error(`createCattleBootstrapToken.publicEnv not allowed: ${key} (public env must use CLAWDLETS_*)`);
        }
        publicEnv[key] = String(v ?? "");
      }

      const now = params.now ?? Date.now();
      const ttlMs = Math.max(30_000, Math.min(60 * 60_000, Math.floor(params.ttlMs ?? 10 * 60_000)));
      return createBootstrapTokenTx({ jobId, requester, cattleName, envKeys, publicEnv, now, ttlMs });
    },

    consumeCattleBootstrapToken: (params) => {
      const token = String(params.token || "").trim();
      if (!token) return null;
      const now = params.now ?? Date.now();
      const tokenHash = sha256Hex(token);
      return consumeBootstrapTokenTx({ tokenHash, now });
    },

    pruneCattleBootstrapTokens: (params) => {
      const now = params.now ?? Date.now();
      const res = pruneBootstrapTokens.run({ now });
      return res.changes;
    },
  };
}
