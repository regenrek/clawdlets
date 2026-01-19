import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => "fixed-job-id",
  };
});

describe("clf queue enqueue unique constraint", () => {
  it("handles unique constraint errors when job id collides", async () => {
    vi.resetModules();
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);
    try {
      q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
        idempotencyKey: "msg-1",
      });
      expect(() =>
        q.enqueue({
          kind: "cattle.reap",
          payload: { dryRun: true },
          requester: "maren",
          idempotencyKey: "msg-2",
        }),
      ).toThrow();
    } finally {
      q.close();
    }
  });
});
