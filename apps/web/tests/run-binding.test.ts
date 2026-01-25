import { describe, expect, it } from "vitest"

import { assertRunBoundToProject } from "../src/sdk/run-binding"

describe("run binding", () => {
  it("rejects cross-project runId", () => {
    expect(() =>
      assertRunBoundToProject({
        runId: "r1" as any,
        runProjectId: "p1" as any,
        expectedProjectId: "p2" as any,
        runKind: "secrets_init",
        expectedKind: "secrets_init",
      }),
    ).toThrow()
  })

  it("rejects run kind mismatch", () => {
    expect(() =>
      assertRunBoundToProject({
        runId: "r1" as any,
        runProjectId: "p1" as any,
        expectedProjectId: "p1" as any,
        runKind: "server_channels",
        expectedKind: "secrets_init",
      }),
    ).toThrow()
  })

  it("allows matching project and kind", () => {
    expect(() =>
      assertRunBoundToProject({
        runId: "r1" as any,
        runProjectId: "p1" as any,
        expectedProjectId: "p1" as any,
        runKind: "secrets_init",
        expectedKind: "secrets_init",
      }),
    ).not.toThrow()
  })

  it("skips kind checks when one side missing", () => {
    expect(() =>
      assertRunBoundToProject({
        runId: "r1" as any,
        runProjectId: "p1" as any,
        expectedProjectId: "p1" as any,
        expectedKind: "secrets_init",
      }),
    ).not.toThrow()
  })
})
