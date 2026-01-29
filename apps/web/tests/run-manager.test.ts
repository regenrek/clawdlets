import { describe, expect, it } from "vitest"

import type { ConvexClient } from "../src/server/convex"
import type { RunManagerEvent } from "../src/server/run-manager"
import { runWithEvents, spawnCommand, spawnCommandCapture } from "../src/server/run-manager"

type RunId = Parameters<typeof runWithEvents>[0]["runId"]

const createClient = () => {
  const events: RunManagerEvent[] = []
  const client = {
    mutation: async (_mutation: unknown, payload: { runId: RunId; events: RunManagerEvent[] }) => {
      events.push(...payload.events)
    },
  } as ConvexClient
  return { client, events }
}

describe("run manager", () => {
  it("caps events and appends truncation notice", async () => {
    const { client, events } = createClient()
    const runId = "run-cap" as RunId

    await runWithEvents({
      client,
      runId,
      redactTokens: [],
      limits: { maxEvents: 3, maxBytes: 1024, maxBatchSize: 2, flushIntervalMs: 1 },
      fn: async (emit) => {
        for (let i = 0; i < 10; i += 1) {
          await emit({ level: "info", message: `line-${i}` })
        }
      },
    })

    expect(events.length).toBe(4)
    expect(events[events.length - 1]?.message).toMatch(/log truncated/i)
  })

  it("caps output by total bytes", async () => {
    const { client, events } = createClient()
    const runId = "run-bytes" as RunId

    await runWithEvents({
      client,
      runId,
      redactTokens: [],
      limits: { maxEvents: 10, maxBytes: 10, maxBatchSize: 5, flushIntervalMs: 1 },
      fn: async (emit) => {
        await emit({ level: "info", message: "1234567890" })
        await emit({ level: "info", message: "extra" })
      },
    })

    expect(events.length).toBe(2)
    expect(events[events.length - 1]?.message).toMatch(/log truncated/i)
  })

  it("cleans up active runs on spawn error", async () => {
    const { client } = createClient()
    const runId = "run-spawn-error" as RunId

    await expect(
      spawnCommand({
        client,
        runId,
        cwd: process.cwd(),
        cmd: "__missing_command__",
        args: [],
        redactTokens: [],
        timeoutMs: 5000,
      }),
    ).rejects.toThrow()

    await expect(
      spawnCommand({
        client,
        runId,
        cwd: process.cwd(),
        cmd: process.execPath,
        args: ["-e", "process.exit(0)"],
        redactTokens: [],
        timeoutMs: 5000,
      }),
    ).resolves.toBeUndefined()
  })

  it("does not inherit unsafe env values", async () => {
    const { client, events } = createClient()
    const runId = "run-env" as RunId
    const original = process.env.RUN_MANAGER_SECRET
    process.env.RUN_MANAGER_SECRET = "supersecret"

    try {
      await spawnCommand({
        client,
        runId,
        cwd: process.cwd(),
        cmd: "node",
        args: ["-e", "console.log(process.env.RUN_MANAGER_SECRET || '')"],
        redactTokens: [],
        timeoutMs: 5000,
      })
    } finally {
      if (original === undefined) delete process.env.RUN_MANAGER_SECRET
      else process.env.RUN_MANAGER_SECRET = original
    }

    expect(events.some((e) => e.message.includes("supersecret"))).toBe(false)
  })

  it("redacts captured stdout and stderr", async () => {
    const { client } = createClient()
    const runId = "run-capture-redact" as RunId
    const secret = "tokenvalue"
    const url = "https://user:pass123@github.com/org/repo.git"
    const bearer = "bearer-token-123"
    const basic = "dXNlcjpwYXNz"
    const apiKey = "api-key-123"
    const queryUrl = "https://example.com?token=querytoken"

    const result = await spawnCommandCapture({
      client,
      runId,
      cwd: process.cwd(),
      cmd: "node",
      args: [
        "-e",
        `console.log("stdout ${url} ${secret} Authorization: Bearer ${bearer} apiKey=${apiKey} ${queryUrl}");` +
          ` console.error("stderr ${url} ${secret} Authorization: Basic ${basic} token=tok123")`,
      ],
      redactTokens: [secret],
      timeoutMs: 5000,
    })

    expect(result.stdout).not.toContain(secret)
    expect(result.stderr).not.toContain(secret)
    expect(result.stdout).not.toContain("pass123")
    expect(result.stderr).not.toContain("pass123")
    expect(result.stdout).not.toContain(bearer)
    expect(result.stderr).not.toContain(basic)
    expect(result.stdout).not.toContain("querytoken")
    expect(result.stderr).not.toContain("tok123")
    expect(result.stdout).not.toContain(apiKey)
    expect(result.stdout).toContain("https://<redacted>@github.com/org/repo.git")
    expect(result.stderr).toContain("https://<redacted>@github.com/org/repo.git")
    expect(result.stdout).toContain("Authorization: Bearer <redacted>")
    expect(result.stderr).toContain("Authorization: Basic <redacted>")
    expect(result.stdout).toContain("apiKey=<redacted>")
    expect(result.stdout).toContain("token=<redacted>")
    expect(result.stderr).toContain("token=<redacted>")
  })

  it("kills processes that ignore SIGTERM", async () => {
    const { client } = createClient()
    const runId = "run-sigkill" as RunId

    await expect(
      spawnCommand({
        client,
        runId,
        cwd: process.cwd(),
        cmd: "node",
        args: [
          "-e",
          "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
        ],
        redactTokens: [],
        timeoutMs: 200,
        killGraceMs: 200,
      }),
    ).rejects.toThrow(/timed out/i)
  })
})
