import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CATTLE_TASK_SCHEMA_VERSION } from "@clawdlets/cattle-core/lib/cattle-task";

const client = {
  enqueue: vi.fn(),
  list: vi.fn(),
  show: vi.fn(),
  cancel: vi.fn(),
};

const parseJobKindMock = vi.fn();

vi.mock("@clawdlets/clf-queue", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/clf-queue")>("@clawdlets/clf-queue");
  parseJobKindMock.mockImplementation((value: unknown) => actual.ClfJobKindSchema.parse(value));
  return {
    ...actual,
    ClfJobKindSchema: {
      parse: parseJobKindMock,
    },
    createClfClient: () => client,
  };
});

describe("clf jobs command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    parseJobKindMock.mockClear();
    process.exitCode = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("enqueues cattle.spawn with task file", async () => {
    client.enqueue.mockResolvedValue({ protocolVersion: 1, jobId: "job-123" });
    const taskPath = path.join(tmpdir(), "task.json");
    fs.writeFileSync(
      taskPath,
      JSON.stringify({
        schemaVersion: CATTLE_TASK_SCHEMA_VERSION,
        taskId: "t1",
        type: "clawdbot.gateway.agent",
        message: "run",
        callbackUrl: "",
      }),
      "utf8",
    );

    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.enqueue!.run({
      args: { kind: "cattle.spawn", requester: "maren", persona: "rex", taskFile: taskPath },
    } as any);
    expect(client.enqueue).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("job-123");
  });

  it("reports invalid priority", async () => {
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.enqueue!.run({
      args: { kind: "cattle.reap", requester: "maren", priority: "nope" },
    } as any);
    expect(process.exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/invalid --priority/i));
  });

  it("rejects invalid task file JSON", async () => {
    const taskPath = path.join(tmpdir(), "bad-task.json");
    fs.writeFileSync(taskPath, "{ nope", "utf8");
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.enqueue!.run({
      args: { kind: "cattle.spawn", requester: "maren", persona: "rex", taskFile: taskPath, json: true },
    } as any);
    expect(process.exitCode).toBe(2);
  });

  it("rejects unsupported job kind after parsing", async () => {
    parseJobKindMock.mockReturnValue("unknown.kind");
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.enqueue!.run({
      args: { kind: "cattle.reap", requester: "maren" },
    } as any);
    expect(process.exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/unsupported job kind/i));
  });

  it("lists jobs in json mode", async () => {
    client.list.mockResolvedValue({ protocolVersion: 1, jobs: [] });
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.list!.run({ args: { json: true } } as any);
    expect(JSON.parse(writes.join(""))).toEqual({ protocolVersion: 1, jobs: [] });
    writeSpy.mockRestore();
  });

  it("lists jobs in table mode", async () => {
    client.list.mockResolvedValue({
      protocolVersion: 1,
      jobs: [
        {
          jobId: "job-12345678",
          kind: "cattle.spawn",
          status: "queued",
          attempt: 1,
          maxAttempts: 3,
          updatedAt: "2026-01-19T00:00:00Z",
        },
      ],
    });
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.list!.run({ args: {} } as any);
    const output = String(logSpy.mock.calls[0]?.[0] || "");
    expect(output).toContain("JOB");
    expect(output).toContain("UPDATED");
    expect(output).toContain("job-1234");
  });

  it("rejects invalid list limit", async () => {
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.list!.run({ args: { limit: "x" } } as any);
    expect(process.exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/invalid --limit/i));
  });

  it("shows job in json mode", async () => {
    client.show.mockResolvedValue({ protocolVersion: 1, job: { jobId: "job-1" } });
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.show!.run({ args: { jobId: "job-1", json: true } } as any);
    expect(JSON.parse(writes.join(""))).toEqual({ protocolVersion: 1, job: { jobId: "job-1" } });
    writeSpy.mockRestore();
  });

  it("shows job in text mode", async () => {
    client.show.mockResolvedValue({ protocolVersion: 1, job: { jobId: "job-1" } });
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.show!.run({ args: { jobId: "job-1" } } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("\"jobId\""));
  });

  it("reports show errors in json mode", async () => {
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.show!.run({ args: { jobId: "", json: true } } as any);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(writes.join(""))).toMatchObject({ ok: false });
    writeSpy.mockRestore();
  });

  it("cancels a job and prints ok", async () => {
    client.cancel.mockResolvedValue({ protocolVersion: 1, ok: true });
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.cancel!.run({ args: { jobId: "job-1" } } as any);
    expect(logSpy).toHaveBeenCalledWith("ok");
  });

  it("reports cancel errors in text mode", async () => {
    client.cancel.mockRejectedValue(new Error("boom"));
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.cancel!.run({ args: { jobId: "job-1" } } as any);
    expect(process.exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/boom/));
  });

  it("reports cancel errors in json mode", async () => {
    client.cancel.mockRejectedValue(new Error("boom"));
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });
    const { jobs } = await import("../src/commands/jobs");
    await jobs.subCommands!.cancel!.run({ args: { jobId: "job-1", json: true } } as any);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(writes.join(""))).toMatchObject({ ok: false });
    writeSpy.mockRestore();
  });
});
