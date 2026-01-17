import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const lastEnqueue: { value: unknown } = { value: null };
const enqueueReturn: { value: unknown } = { value: { protocolVersion: 1, jobId: "job-1" } };

vi.mock("@clawdlets/clf-queue", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/clf-queue")>("@clawdlets/clf-queue");
  return {
    ...actual,
    createClfClient: () => ({
      health: async () => ({ ok: true as const }),
      enqueue: async (req: unknown) => {
        lastEnqueue.value = req;
        return enqueueReturn.value as any;
      },
      list: async () => ({ protocolVersion: 1, jobs: [] }),
      show: async () => ({ protocolVersion: 1, job: {} } as any),
      cancel: async () => ({ protocolVersion: 1, ok: true as const }),
    }),
  };
});

beforeEach(() => {
  lastEnqueue.value = null;
  enqueueReturn.value = { protocolVersion: 1, jobId: "job-1" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("clf jobs", () => {
  it("enqueues cattle.reap and prints json", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.enqueue!.run({
      args: { _: ["cattle.reap"], requester: "maren", dryRun: true, json: true },
    } as any);

    const out = JSON.parse(writes.join(""));
    expect(out.jobId).toBe("job-1");
    expect((lastEnqueue.value as any)?.kind).toBe("cattle.reap");
  });

  it("enqueues cattle.spawn from message/task-id", async () => {
    enqueueReturn.value = { protocolVersion: 1, jobId: "job-2" };
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.enqueue!.run({
      args: {
        _: ["cattle.spawn"],
        requester: "maren",
        identity: "rex",
        taskId: "t1",
        message: "do it",
        ttl: "2h",
        json: true,
      },
    } as any);

    expect((lastEnqueue.value as any)?.kind).toBe("cattle.spawn");
    expect((lastEnqueue.value as any)?.payload?.identity).toBe("rex");
    expect((lastEnqueue.value as any)?.payload?.task?.taskId).toBe("t1");
  });
});
