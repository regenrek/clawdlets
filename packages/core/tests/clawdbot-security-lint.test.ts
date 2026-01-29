import { describe, expect, it } from "vitest";

describe("clawdbot security lint", () => {
  it("flags open Telegram DMs without wildcard allowFrom", async () => {
    const { lintClawdbotSecurityConfig } = await import("../src/lib/clawdbot-security-lint");

    const res = lintClawdbotSecurityConfig({
      botId: "agent",
      clawdbot: {
        channels: {
          telegram: {
            dmPolicy: "open",
            allowFrom: [],
          },
        },
      },
    });
    expect(res.summary.critical).toBe(2);
    expect(res.findings.map((f) => f.id)).toContain("channels.telegram.dmPolicy.open");
    expect(res.findings.map((f) => f.id)).toContain("channels.telegram.dmPolicy.open_missing_wildcard");
  });

  it("flags open group policy and wildcard groupAllowFrom", async () => {
    const { lintClawdbotSecurityConfig } = await import("../src/lib/clawdbot-security-lint");

    const res = lintClawdbotSecurityConfig({
      clawdbot: {
        channels: {
          whatsapp: {
            groupPolicy: "open",
            groupAllowFrom: ["*"],
          },
        },
      },
    });
    expect(res.summary.critical).toBe(2);
    expect(res.findings.map((f) => f.id)).toContain("channels.whatsapp.groupPolicy.open");
    expect(res.findings.map((f) => f.id)).toContain("channels.whatsapp.groupAllowFrom.wildcard");
  });

  it("warns when multi-user DM shares main session", async () => {
    const { lintClawdbotSecurityConfig } = await import("../src/lib/clawdbot-security-lint");

    const res = lintClawdbotSecurityConfig({
      clawdbot: {
        session: { dmScope: "main" },
        channels: {
          slack: {
            enabled: true,
            dm: { policy: "pairing", allowFrom: ["U1", "U2"] },
          },
        },
      },
    });
    expect(res.summary.warn).toBe(1);
    expect(res.findings[0]?.id).toBe("session.dmScope.multi_user_dm");
  });
});
