import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

describe("cattle-state", () => {
  it("upserts and lists active servers", async () => {
    const { openCattleState } = await import("../src/lib/cattle-state");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cattle-state-"));
    const dbPath = path.join(dir, "state.sqlite");

    const st = openCattleState(dbPath);
    try {
      st.upsertServer({
        id: "123",
        name: "cattle-rex-123",
        identity: "rex",
        task: "fix-issue-42",
        taskId: "issue-42",
        ttlSeconds: 7200,
        createdAt: 1700000000,
        expiresAt: 1700007200,
        labels: { "managed-by": "clawdlets", cattle: "true" },
        lastStatus: "running",
        lastIpv4: "1.2.3.4",
      });

      const active = st.listActive();
      expect(active.length).toBe(1);
      expect(active[0]?.id).toBe("123");
      expect(active[0]?.name).toBe("cattle-rex-123");
      expect(active[0]?.identity).toBe("rex");
    } finally {
      st.close();
    }
  });

  it("finds by id/name and marks deleted", async () => {
    const { openCattleState } = await import("../src/lib/cattle-state");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cattle-state-"));
    const dbPath = path.join(dir, "state.sqlite");

    const st = openCattleState(dbPath);
    try {
      st.upsertServer({
        id: "555",
        name: "cattle-rex-555",
        identity: "rex",
        task: "smoke",
        taskId: "smoke-1",
        ttlSeconds: 60,
        createdAt: 1700000000,
        expiresAt: 1700000060,
        labels: {},
        lastStatus: "running",
        lastIpv4: "",
      });

      expect(st.findActiveByIdOrName("555")?.name).toBe("cattle-rex-555");
      expect(st.findActiveByIdOrName("cattle-rex-555")?.id).toBe("555");
      expect(st.findActiveByIdOrName("missing")).toBeNull();

      st.markDeletedById("555", 1700000010);
      expect(st.listActive().length).toBe(0);
      expect(st.findActiveByIdOrName("555")).toBeNull();
    } finally {
      st.close();
    }
  });

  it("rejects unknown schema versions", async () => {
    const { openCattleState } = await import("../src/lib/cattle-state");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cattle-state-"));
    const dbPath = path.join(dir, "state.sqlite");

    const require = createRequire(import.meta.url);
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    db.pragma("user_version = 999");
    db.close();

    expect(() => openCattleState(dbPath)).toThrow(/unsupported cattle state schema version/i);
  });
});

