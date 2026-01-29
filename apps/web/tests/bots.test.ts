import { describe, expect, it } from "vitest"

import { LIVE_SCHEMA_ERROR_FALLBACK, sanitizeLiveSchemaError } from "~/sdk/bots"

describe("setBotClawdbotConfig live schema errors", () => {
  it("sanitizes unsafe schema errors", () => {
    const err = new Error("ssh: connect to host 10.0.0.1 port 22: Connection timed out; cmd: bash -lc 'secret'")
    expect(sanitizeLiveSchemaError(err)).toBe(LIVE_SCHEMA_ERROR_FALLBACK)
  })
})
