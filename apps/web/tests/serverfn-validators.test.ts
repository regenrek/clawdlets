import { describe, expect, it } from "vitest"

import {
  parseProjectHostInput,
  parseProjectRunHostInput,
  parseServerChannelsExecuteInput,
  parseServerChannelsStartInput,
} from "../src/sdk/serverfn-validators"

describe("serverfn validators", () => {
  it("accepts allowed server channels ops", () => {
    expect(
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "alpha",
        botId: "maren",
        op: "status",
      }),
    ).toMatchObject({ host: "alpha", botId: "maren", op: "status" })

    expect(
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        botId: "maren",
        op: "capabilities",
        timeout: "15000",
        json: true,
      }),
    ).toMatchObject({ op: "capabilities", timeoutMs: 15000, json: true })
  })

  it("rejects non-allowlisted server channels ops", () => {
    expect(() =>
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "alpha",
        botId: "maren",
        op: "rm",
      }),
    ).toThrow()
  })

  it("rejects invalid host/bot ids", () => {
    expect(() =>
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "ALPHA",
        botId: "maren",
        op: "status",
      }),
    ).toThrow()

    expect(() =>
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "alpha",
        botId: "Maren",
        op: "status",
      }),
    ).toThrow()
  })

  it("parses timeouts and validates bounds", () => {
    expect(
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        botId: "maren",
        op: "status",
        timeout: "",
      }),
    ).toMatchObject({ timeoutMs: 10000 })

    expect(() =>
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        botId: "maren",
        op: "status",
        timeout: "999",
      }),
    ).toThrow(/invalid timeout/i)

    expect(() =>
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        botId: "maren",
        op: "status",
        timeout: "121000",
      }),
    ).toThrow(/invalid timeout/i)
  })

  it("rejects overlong optional args", () => {
    const longChannel = "a".repeat(65)
    expect(() =>
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        botId: "maren",
        op: "status",
        channel: longChannel,
      }),
    ).toThrow(/invalid input/i)
  })

  it("parses project+host inputs", () => {
    expect(parseProjectHostInput({ projectId: "p1", host: "alpha" })).toEqual({ projectId: "p1", host: "alpha" })
    expect(parseProjectHostInput({ projectId: "p1", host: "" })).toEqual({ projectId: "p1", host: "" })
  })

  it("parses project+run+host inputs", () => {
    expect(parseProjectRunHostInput({ projectId: "p1", runId: "r1", host: "alpha" })).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
    })
    expect(() => parseProjectRunHostInput({ projectId: "p1", runId: "r1", host: "" })).toThrow()
  })
})
