import { describe, expect, it, vi } from "vitest"

describe("clawdbot live schema cache", () => {
  it("caches live schema per host/bot", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce12", "utf8"),
    }))
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) =>
      [
        "__CLAWDBOT_SCHEMA_BEGIN__6e6f6e63653132__",
        "{\"schema\":{\"type\":\"object\"},\"uiHints\":{},\"version\":\"1.0.0\",\"generatedAt\":\"x\",\"clawdbotRev\":\"rev\"}",
        "__CLAWDBOT_SCHEMA_END__6e6f6e63653132__",
      ].join("\n"),
    )
    const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    const second = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(first).toEqual(second)
    expect(query).toHaveBeenCalledTimes(2)
    expect(mutation).toHaveBeenCalledTimes(1)
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({ projectId: "p1", host: "h1", botId: "bot1" })
    expect(sshCapture).toHaveBeenCalledTimes(1)
    expect(sshCapture.mock.calls[0]?.[0]).toBe("root@127.0.0.1")
    expect(sshCapture.mock.calls[0]?.[2]).toMatchObject({
      cwd: expect.stringMatching(/\/tmp$/),
      timeoutMs: 15_000,
      maxOutputBytes: 5 * 1024 * 1024,
    })
    vi.useRealTimers()
  })

  it("dedupes in-flight live schema fetches", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce34", "utf8"),
    }))
    let resolveGate: () => void
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) => {
      await gate
      return [
        "__CLAWDBOT_SCHEMA_BEGIN__6e6f6e63653334__",
        "{\"schema\":{\"type\":\"object\"},\"uiHints\":{},\"version\":\"1.0.0\",\"generatedAt\":\"x\",\"clawdbotRev\":\"rev\"}",
        "__CLAWDBOT_SCHEMA_END__6e6f6e63653334__",
      ].join("\n")
    })
    const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const firstPromise = fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    const secondPromise = fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    await new Promise((resolve) => setImmediate(resolve))
    expect(sshCapture).toHaveBeenCalledTimes(1)
    resolveGate!()
    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first).toEqual(second)
    expect(mutation).toHaveBeenCalledTimes(1)
  })

  it("anchors TTL to completion time", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.setSystemTime(1_000_000)
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce66", "utf8"),
    }))
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      return [
        "__CLAWDBOT_SCHEMA_BEGIN__6e6f6e63653636__",
        "{\"schema\":{\"type\":\"object\"},\"uiHints\":{},\"version\":\"1.0.0\",\"generatedAt\":\"x\",\"clawdbotRev\":\"rev\"}",
        "__CLAWDBOT_SCHEMA_END__6e6f6e63653636__",
      ].join("\n")
    })
    const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const firstPromise = fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    await vi.advanceTimersByTimeAsync(5_000)
    const first = await firstPromise
    await vi.advanceTimersByTimeAsync(14_999)
    const second = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(first).toEqual(second)
    expect(sshCapture).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("does not leak cached schema across roles", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce55", "utf8"),
    }))
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) =>
      [
        "__CLAWDBOT_SCHEMA_BEGIN__6e6f6e63653535__",
        "{\"schema\":{\"type\":\"object\"},\"uiHints\":{},\"version\":\"1.0.0\",\"generatedAt\":\"x\",\"clawdbotRev\":\"rev\"}",
        "__CLAWDBOT_SCHEMA_END__6e6f6e63653535__",
      ].join("\n"),
    )
    const query = vi
      .fn()
      .mockResolvedValueOnce({ project: { localPath: "/tmp" }, role: "admin" })
      .mockResolvedValueOnce({ project: { localPath: "/tmp" }, role: "viewer" })
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const adminResult = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    const viewerResult = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(adminResult.ok).toBe(true)
    expect(viewerResult.ok).toBe(false)
    if (!viewerResult.ok) expect(viewerResult.message).toBe("admin required")
    expect(sshCapture).toHaveBeenCalledTimes(1)
    expect(mutation).toHaveBeenCalledTimes(1)
  })

  it("rejects non-admin before SSH", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) => "")
    const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "viewer" }))
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const res = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("admin required")
    expect(mutation).not.toHaveBeenCalled()
    expect(sshCapture).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("rate-limit blocks SSH", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce99", "utf8"),
    }))
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) => "")
    const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => {
      const err: any = new Error("ConvexError")
      err.data = { code: "rate_limited", message: "too many requests" }
      throw err
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const res = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("too many requests")
    expect(sshCapture).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("caches failures briefly to avoid SSH retries", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce00", "utf8"),
    }))
    const sshCapture = vi.fn(async (_target: string, _cmd: string, _opts?: unknown) => {
      throw new Error("boom")
    })
    const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
    const mutation = vi.fn(async (_mutation?: unknown, _payload?: unknown) => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    const second = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(first).toEqual(second)
    expect(first.ok).toBe(false)
    expect(sshCapture).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
