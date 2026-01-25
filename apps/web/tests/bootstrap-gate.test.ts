import { describe, expect, it } from "vitest"

import { canBootstrapFromDoctorGate } from "../src/lib/bootstrap-gate"

describe("canBootstrapFromDoctorGate", () => {
  it("requires host", () => {
    expect(canBootstrapFromDoctorGate({ host: "", force: false, doctor: null })).toBe(false)
    expect(canBootstrapFromDoctorGate({ host: "   ", force: true, doctor: { ok: true } })).toBe(false)
  })

  it("allows force regardless of doctor", () => {
    expect(canBootstrapFromDoctorGate({ host: "h", force: true, doctor: null })).toBe(true)
    expect(canBootstrapFromDoctorGate({ host: "h", force: true, doctor: { ok: false } })).toBe(true)
  })

  it("requires doctor ok when not forcing", () => {
    expect(canBootstrapFromDoctorGate({ host: "h", force: false, doctor: null })).toBe(false)
    expect(canBootstrapFromDoctorGate({ host: "h", force: false, doctor: { ok: false } })).toBe(false)
    expect(canBootstrapFromDoctorGate({ host: "h", force: false, doctor: { ok: true } })).toBe(true)
  })
})

