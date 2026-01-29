import { describe, expect, it, vi } from "vitest";

type CaptureConfig = {
  statusOutput: string;
  originUrl?: string | null;
  originDefaultRef?: string | null;
  originHead?: string | null;
};

type SpawnResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

function createCapture(config: CaptureConfig) {
  return vi.fn(async (_cmd: string, args: string[]) => {
    if (args[0] === "status") return config.statusOutput;
    if (args[0] === "for-each-ref") {
      if (config.originDefaultRef === null) return "";
      const ref = config.originDefaultRef ?? "origin/main";
      const head = config.originHead ?? "origin-head";
      return `${ref} ${head}`;
    }
    if (args[0] === "remote" && args[1] === "show") return "HEAD branch: main";
    if (args[0] === "rev-parse") return config.originHead ?? "origin-head";
    if (args[0] === "config" && args[1] === "--get") {
      if (config.originUrl === null) throw new Error("no origin");
      return config.originUrl ?? "git@github.com:org/repo.git";
    }
    return "";
  });
}

async function loadGitServer(options: {
  captureConfig: CaptureConfig;
  spawnResult?: SpawnResult;
  spawnImpl?: () => Promise<SpawnResult>;
}) {
  vi.resetModules();
  const capture = createCapture(options.captureConfig);
  const spawnCommandCapture = vi.fn(async () => {
    if (options.spawnImpl) return await options.spawnImpl();
    return {
      exitCode: options.spawnResult?.exitCode ?? 0,
      stdout: options.spawnResult?.stdout ?? "ok",
      stderr: options.spawnResult?.stderr ?? "",
    };
  });
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; status?: string; errorMessage?: string }) => {
    if (payload?.kind) return { runId: "run1" };
    return null;
  });
  const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }));

  vi.doMock("@clawdlets/core/lib/run", () => ({ capture }));
  vi.doMock("~/server/redaction", () => ({ readClawdletsEnvTokens: async () => ["secret"] }));
  vi.doMock("~/server/run-manager", () => ({ spawnCommandCapture }));
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }));

  const mod = await import("~/server/git.server");
  mod.__test_gitStatusCache.clear();
  return { mod, spawnCommandCapture, mutation, capture };
}

describe("git push flow", () => {
  it("uses upstream push and marks run succeeded", async () => {
    const { mod, spawnCommandCapture, mutation } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
          "\n",
        ),
        originDefaultRef: "origin/main",
      },
    });
    const res = await mod.executeGitPush({ projectId: "p1" as any });
    expect(res.ok).toBe(true);
    expect(res.runId).toBe("run1");

    const call = (spawnCommandCapture as any).mock.calls[0]?.[0] as {
      args?: string[];
      env?: Record<string, string>;
      maxCaptureBytes?: number;
      allowNonZeroExit?: boolean;
      envAllowlist?: string[];
    };
    expect(call?.args).toEqual(["push"]);
    expect(call?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(call?.env?.GIT_ASKPASS).toBe("/bin/false");
    expect(call?.envAllowlist).toEqual(["GIT_TERMINAL_PROMPT", "GIT_ASKPASS", "SSH_AUTH_SOCK"]);
    expect(call?.maxCaptureBytes).toBe(256_000);
    expect(call?.allowNonZeroExit).toBe(true);

    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.status).toBe("succeeded");
    expect(statusCalls[0]?.errorMessage).toBeUndefined();
  });

  it("uses set-upstream when no upstream configured", async () => {
    const { mod, spawnCommandCapture } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main"].join("\n"),
        originUrl: "git@github.com:org/repo.git",
        originDefaultRef: "origin/main",
      },
    });
    const res = await mod.executeGitPush({ projectId: "p1" as any });
    expect(res.ok).toBe(true);

    const call = (spawnCommandCapture as any).mock.calls[0]?.[0] as { args?: string[] };
    expect(call?.args).toEqual(["push", "--set-upstream", "origin", "main"]);
  });

  it("marks run failed on non-zero exit", async () => {
    const { mod, mutation } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
          "\n",
        ),
        originDefaultRef: "origin/main",
      },
      spawnResult: { exitCode: 1, stdout: "", stderr: "push failed" },
    });
    const res = await mod.executeGitPush({ projectId: "p1" as any });
    expect(res.ok).toBe(false);

    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.status).toBe("failed");
    expect(statusCalls[0]?.errorMessage).toBe("git push failed");
  });

  it("clears cached status after push", async () => {
    const { mod, capture } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
          "\n",
        ),
        originDefaultRef: "origin/main",
      },
    });

    await mod.readGitStatus("/tmp/repo");
    const statusCallsAfterFirst = capture.mock.calls.filter((call) => call[1][0] === "status").length;

    await mod.executeGitPush({ projectId: "p1" as any });
    await mod.readGitStatus("/tmp/repo");

    const statusCallsAfterSecond = capture.mock.calls.filter((call) => call[1][0] === "status").length;
    expect(statusCallsAfterSecond).toBeGreaterThan(statusCallsAfterFirst);
  });

  it("dedupes concurrent git pushes per repo", async () => {
    let resolvePush: (value: SpawnResult) => void;
    const pushPromise = new Promise<SpawnResult>((resolve) => {
      resolvePush = resolve;
    });
    const { mod, spawnCommandCapture, mutation } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
          "\n",
        ),
        originDefaultRef: "origin/main",
      },
      spawnImpl: async () => await pushPromise,
    });

    const first = mod.executeGitPush({ projectId: "p1" as any });
    const second = mod.executeGitPush({ projectId: "p1" as any });

    await new Promise((resolve) => setImmediate(resolve));
    expect(spawnCommandCapture).toHaveBeenCalledTimes(1);

    resolvePush!({ exitCode: 0, stdout: "ok", stderr: "" });
    const [res1, res2] = await Promise.all([first, second]);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.runId).toBe("run1");
    expect(res2.runId).toBe("run1");

    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind);
    expect(runCreates).toHaveLength(1);
  });

  it("rejects pushes when origin remote is missing", async () => {
    const { mod, spawnCommandCapture, mutation } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main"].join("\n"),
        originUrl: null,
        originDefaultRef: null,
      },
    });
    await expect(mod.executeGitPush({ projectId: "p1" as any })).rejects.toThrow(/missing origin remote/i);
    expect(spawnCommandCapture).not.toHaveBeenCalled();
    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind);
    expect(runCreates).toHaveLength(0);
  });

  it("marks run failed when spawn throws", async () => {
    const { mod, mutation } = await loadGitServer({
      captureConfig: {
        statusOutput: ["# branch.oid local-head", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -0"].join(
          "\n",
        ),
        originDefaultRef: "origin/main",
      },
      spawnImpl: async () => {
        throw new Error("spawn failed");
      },
    });

    await expect(mod.executeGitPush({ projectId: "p1" as any })).rejects.toThrow();

    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]?.status).toBe("failed");
    expect(statusCalls[0]?.errorMessage).toBe("git push failed");
  });
});
