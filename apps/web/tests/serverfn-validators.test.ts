import { describe, expect, it } from "vitest"

import {
	  parseBotClawdbotConfigInput,
	  parseHostSshKeysInput,
	  parseProjectIdInput,
	  parseProjectBotInput,
	  parseProjectHostInput,
	  parseProjectHostRequiredInput,
	  parseProjectRunHostInput,
  parseServerChannelsExecuteInput,
  parseServerChannelsStartInput,
  parseServerLogsExecuteInput,
  parseServerRestartExecuteInput,
  parseServerRestartStartInput,
  parseSecretsInitExecuteInput,
  parseWriteHostSecretsInput,
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

  it("defaults non-string optional args to empty", () => {
    expect(
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        botId: "maren",
        op: "status",
        channel: 123,
        account: null,
        target: false,
      } as any),
    ).toMatchObject({ channel: "", account: "", target: "" })
  })

  it("parses project+host inputs", () => {
    expect(parseProjectHostInput({ projectId: "p1", host: "alpha" })).toEqual({ projectId: "p1", host: "alpha" })
    expect(parseProjectHostInput({ projectId: "p1", host: "" })).toEqual({ projectId: "p1", host: "" })
  })

  it("rejects invalid project ids", () => {
    expect(() => parseProjectIdInput({ projectId: "" })).toThrow()
    expect(() => parseProjectIdInput({ projectId: 123 })).toThrow()
    expect(() => parseProjectIdInput({})).toThrow()
    expect(() => parseProjectIdInput([] as any)).toThrow()
  })

  it("rejects invalid project ids for bot inputs", () => {
    expect(() => parseProjectBotInput({ projectId: "", botId: "maren" })).toThrow()
    expect(() => parseBotClawdbotConfigInput({ projectId: "", botId: "maren", clawdbot: {} })).toThrow()
  })

  it("trims botId and validates schemaMode", () => {
    expect(
      parseBotClawdbotConfigInput({
        projectId: "p1",
        botId: " maren ",
        host: "alpha",
        schemaMode: "live",
        clawdbot: {},
      }),
    ).toMatchObject({ botId: "maren", schemaMode: "live" })

    expect(() =>
      parseBotClawdbotConfigInput({
        projectId: "p1",
        botId: "maren",
        host: "alpha",
        schemaMode: "fast",
        clawdbot: {},
      }),
    ).toThrow(/invalid schemamode/i)
  })

  it("requires host when configured", () => {
    expect(parseProjectHostRequiredInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })
    expect(() => parseProjectHostRequiredInput({ projectId: "p1", host: "" })).toThrow()
  })

  it("parses project+run+host inputs", () => {
    expect(parseProjectRunHostInput({ projectId: "p1", runId: "r1", host: "alpha" })).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
    })
    expect(() => parseProjectRunHostInput({ projectId: "p1", runId: "r1", host: "" })).toThrow()
  })

  it("parses server logs lines and validates digits", () => {
    expect(
      parseServerLogsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        unit: "",
        lines: "",
      }),
    ).toMatchObject({ lines: "200" })

    expect(() =>
      parseServerLogsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        lines: "12x",
      }),
    ).toThrow(/invalid lines/i)
  })

  it("parses secrets init inputs with secret values", () => {
    expect(
      parseSecretsInitExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        allowPlaceholders: true,
        adminPassword: "pw",
        secrets: { discord_token: "abc" },
      }),
    ).toMatchObject({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      allowPlaceholders: true,
      adminPassword: "pw",
      secrets: { discord_token: "abc" },
    })
  })

  it("rejects invalid writeHostSecrets input", () => {
    expect(() => parseWriteHostSecretsInput({ projectId: "p1", host: "alpha", secrets: [] })).toThrow()
  })

  it("parses writeHostSecrets with safe secret names", () => {
    expect(parseWriteHostSecretsInput({ projectId: "p1", host: "alpha", secrets: { discord_token: "abc" } })).toEqual({
      projectId: "p1",
      host: "alpha",
      secrets: { discord_token: "abc" },
    })
  })

	  it("parses server restart inputs", () => {
	    expect(parseServerRestartStartInput({ projectId: "p1", host: "alpha", unit: "clawdbot-*.service" })).toEqual({
	      projectId: "p1",
	      host: "alpha",
      unit: "clawdbot-*.service",
    })

    expect(
      parseServerRestartExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        unit: "clawdbot-agent.service",
        targetHost: "",
        confirm: "restart clawdbot-agent.service",
      }),
	    ).toMatchObject({ unit: "clawdbot-agent.service", confirm: "restart clawdbot-agent.service" })
	  })

	  it("rejects ssh key import file paths", () => {
	    expect(() =>
	      parseHostSshKeysInput({
	        projectId: "p1",
	        host: "alpha",
	        keyText: "",
	        knownHostsText: "",
	        keyFilePath: "/etc/passwd",
	      }),
	    ).toThrow(/file path imports/i)
	  })

	  it("parses ssh key import text inputs", () => {
	    expect(
	      parseHostSshKeysInput({
	        projectId: "p1",
	        host: "alpha",
	        keyText: "ssh-ed25519 AAAA",
	        knownHostsText: "github.com ssh-ed25519 AAAA",
	      }),
	    ).toEqual({
	      projectId: "p1",
	      host: "alpha",
	      keyText: "ssh-ed25519 AAAA",
	      knownHostsText: "github.com ssh-ed25519 AAAA",
	    })
	  })
	})
