import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

describe("clf queue bootstrap tokens", () => {
  it("validates inputs, dedupes env keys, and expires tokens", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);
    try {
      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "",
          requester: "maren",
          cattleName: "cattle-rex",
          envKeys: [],
        }),
      ).toThrow(/jobId missing/i);
      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "job-1",
          requester: "",
          cattleName: "cattle-rex",
          envKeys: [],
        }),
      ).toThrow(/requester missing/i);
      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "job-1",
          requester: "maren",
          cattleName: "",
          envKeys: [],
        }),
      ).toThrow(/cattleName missing/i);

      const issued = q.createCattleBootstrapToken({
        jobId: "job-1",
        requester: "maren",
        cattleName: "cattle-rex",
        envKeys: ["OPENAI_API_KEY", " OPENAI_API_KEY ", "GITHUB_TOKEN"],
        publicEnv: { CLAWDLETS_CATTLE_AUTO_SHUTDOWN: "0" },
        now: 0,
        ttlMs: 30_000,
      });
      const consumed = q.consumeCattleBootstrapToken({ token: issued.token, now: 1 });
      expect(consumed?.envKeys).toEqual(["OPENAI_API_KEY", "GITHUB_TOKEN"]);

      const expiredToken = q.createCattleBootstrapToken({
        jobId: "job-2",
        requester: "maren",
        cattleName: "cattle-rex",
        envKeys: [],
        publicEnv: {},
        now: 0,
        ttlMs: 1,
      });
      const expired = q.consumeCattleBootstrapToken({ token: expiredToken.token, now: 60_000 });
      expect(expired).toBeNull();

      expect(q.consumeCattleBootstrapToken({ token: "" })).toBeNull();

      const withBlankKey = q.createCattleBootstrapToken({
        jobId: "job-3",
        requester: "maren",
        cattleName: "cattle-rex",
        envKeys: [],
        publicEnv: { "": "x", CLAWDLETS_OK: "1" },
        now: 0,
        ttlMs: 30_000,
      });
      const consumedBlank = q.consumeCattleBootstrapToken({ token: withBlankKey.token, now: 1 });
      expect(consumedBlank?.publicEnv).toEqual({ CLAWDLETS_OK: "1" });
    } finally {
      q.close();
    }
  });

  it("rejects public env without CLAWDLETS_ prefix", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);
    try {
      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "job-1",
          requester: "maren",
          cattleName: "cattle-rex",
          envKeys: [],
          publicEnv: { OPENAI_API_KEY: "nope" } as any,
        }),
      ).toThrow(/publicEnv not allowed/i);
    } finally {
      q.close();
    }
  });

  it("rejects invalid public env var names", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);
    try {
      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "job-1",
          requester: "maren",
          cattleName: "cattle-rex",
          envKeys: [],
          publicEnv: { "BAD-NAME": "nope" } as any,
        }),
      ).toThrow(/invalid env var name/i);
    } finally {
      q.close();
    }
  });

  it("prunes used or expired tokens", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);
    try {
      const issued = q.createCattleBootstrapToken({
        jobId: "job-1",
        requester: "maren",
        cattleName: "cattle-rex",
        envKeys: [],
        publicEnv: {},
        now: 0,
        ttlMs: 60_000,
      });
      q.consumeCattleBootstrapToken({ token: issued.token, now: 1 });
      const pruned = q.pruneCattleBootstrapTokens({ now: 60_000 });
      expect(pruned).toBeGreaterThan(0);
    } finally {
      q.close();
    }
  });
});
