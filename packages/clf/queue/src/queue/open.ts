import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import type { ClfQueue } from "./types.js";
import { ensurePrivateDir, ensurePrivateFile } from "@clawdlets/core/lib/fs-private";
import { migrateClfQueue } from "./migrate.js";
import { createQueueJobOps } from "./jobs.js";
import { createBootstrapTokenOps } from "./bootstrap-tokens.js";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");

export function openClfQueue(dbPath: string): ClfQueue {
  const abs = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
  ensurePrivateDir(path.dirname(abs));

  const db = new BetterSqlite3(abs);
  ensurePrivateFile(abs);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  migrateClfQueue(db);

  const jobs = createQueueJobOps(db);
  const tokens = createBootstrapTokenOps(db);

  return {
    close: () => db.close(),
    ...jobs,
    ...tokens,
  };
}
