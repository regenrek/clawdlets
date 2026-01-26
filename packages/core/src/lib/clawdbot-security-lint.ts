import { getAtPath } from "./object-path.js";

export type ClawdbotSecuritySeverity = "info" | "warn" | "critical";

export type ClawdbotSecurityFinding = {
  severity: ClawdbotSecuritySeverity;
  id: string;
  title: string;
  detail: string;
  remediation?: string;
};

export type ClawdbotSecuritySummary = {
  critical: number;
  warn: number;
  info: number;
};

export type ClawdbotSecurityLintReport = {
  summary: ClawdbotSecuritySummary;
  findings: ClawdbotSecurityFinding[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function summarize(findings: ClawdbotSecurityFinding[]): ClawdbotSecuritySummary {
  const out: ClawdbotSecuritySummary = { critical: 0, warn: 0, info: 0 };
  for (const f of findings) {
    if (f.severity === "critical") out.critical += 1;
    else if (f.severity === "warn") out.warn += 1;
    else out.info += 1;
  }
  return out;
}

function normalizeDmPolicy(value: string): "pairing" | "allowlist" | "open" | "disabled" | "" {
  const v = value.trim();
  if (v === "pairing" || v === "allowlist" || v === "open" || v === "disabled") return v;
  return "";
}

function normalizeGroupPolicy(value: string): "allowlist" | "open" | "disabled" | "" {
  const v = value.trim();
  if (v === "allowlist" || v === "open" || v === "disabled") return v;
  return "";
}

function isChannelEnabled(channelCfg: unknown): boolean {
  if (!isPlainObject(channelCfg)) return false;
  const enabled = channelCfg["enabled"];
  return enabled !== false;
}

type DmPolicySpec = {
  channelId: string;
  label: string;
  policyPath: string[];
  allowFromPath: string[];
};

const DM_POLICY_SPECS: DmPolicySpec[] = [
  {
    channelId: "telegram",
    label: "Telegram",
    policyPath: ["channels", "telegram", "dmPolicy"],
    allowFromPath: ["channels", "telegram", "allowFrom"],
  },
  {
    channelId: "whatsapp",
    label: "WhatsApp",
    policyPath: ["channels", "whatsapp", "dmPolicy"],
    allowFromPath: ["channels", "whatsapp", "allowFrom"],
  },
  {
    channelId: "signal",
    label: "Signal",
    policyPath: ["channels", "signal", "dmPolicy"],
    allowFromPath: ["channels", "signal", "allowFrom"],
  },
  {
    channelId: "imessage",
    label: "iMessage",
    policyPath: ["channels", "imessage", "dmPolicy"],
    allowFromPath: ["channels", "imessage", "allowFrom"],
  },
  {
    channelId: "bluebubbles",
    label: "BlueBubbles",
    policyPath: ["channels", "bluebubbles", "dmPolicy"],
    allowFromPath: ["channels", "bluebubbles", "allowFrom"],
  },
  {
    channelId: "discord",
    label: "Discord",
    policyPath: ["channels", "discord", "dm", "policy"],
    allowFromPath: ["channels", "discord", "dm", "allowFrom"],
  },
  {
    channelId: "slack",
    label: "Slack",
    policyPath: ["channels", "slack", "dm", "policy"],
    allowFromPath: ["channels", "slack", "dm", "allowFrom"],
  },
];

type GroupPolicySpec = {
  channelId: string;
  label: string;
  policyPath: string[];
  groupAllowFromPath: string[];
};

const GROUP_POLICY_SPECS: GroupPolicySpec[] = [
  {
    channelId: "telegram",
    label: "Telegram",
    policyPath: ["channels", "telegram", "groupPolicy"],
    groupAllowFromPath: ["channels", "telegram", "groupAllowFrom"],
  },
  {
    channelId: "whatsapp",
    label: "WhatsApp",
    policyPath: ["channels", "whatsapp", "groupPolicy"],
    groupAllowFromPath: ["channels", "whatsapp", "groupAllowFrom"],
  },
  {
    channelId: "signal",
    label: "Signal",
    policyPath: ["channels", "signal", "groupPolicy"],
    groupAllowFromPath: ["channels", "signal", "groupAllowFrom"],
  },
  {
    channelId: "imessage",
    label: "iMessage",
    policyPath: ["channels", "imessage", "groupPolicy"],
    groupAllowFromPath: ["channels", "imessage", "groupAllowFrom"],
  },
  {
    channelId: "bluebubbles",
    label: "BlueBubbles",
    policyPath: ["channels", "bluebubbles", "groupPolicy"],
    groupAllowFromPath: ["channels", "bluebubbles", "groupAllowFrom"],
  },
  {
    channelId: "discord",
    label: "Discord",
    policyPath: ["channels", "discord", "groupPolicy"],
    groupAllowFromPath: ["channels", "discord", "groupAllowFrom"],
  },
  {
    channelId: "slack",
    label: "Slack",
    policyPath: ["channels", "slack", "groupPolicy"],
    groupAllowFromPath: ["channels", "slack", "groupAllowFrom"],
  },
];

export function lintClawdbotSecurityConfig(params: {
  clawdbot: unknown;
  botId?: string;
}): ClawdbotSecurityLintReport {
  const cfg = isPlainObject(params.clawdbot) ? params.clawdbot : {};
  const findings: ClawdbotSecurityFinding[] = [];
  const botLabel = params.botId ? `bot=${params.botId} ` : "";

  {
    const tailscaleMode = readString(getAtPath(cfg, ["gateway", "tailscale", "mode"]));
    if (tailscaleMode === "funnel") {
      findings.push({
        id: "gateway.tailscale.funnel",
        severity: "critical",
        title: `${botLabel}Gateway is publicly exposed (Tailscale Funnel)`,
        detail: `gateway.tailscale.mode="funnel"`,
        remediation: `Set gateway.tailscale.mode="serve" (tailnet-only) or "off".`,
      });
    }
  }

  {
    const allowInsecureAuth = getAtPath(cfg, ["gateway", "controlUi", "allowInsecureAuth"]);
    if (allowInsecureAuth === true) {
      findings.push({
        id: "gateway.controlUi.allowInsecureAuth",
        severity: "warn",
        title: `${botLabel}Control UI insecure auth enabled`,
        detail: "gateway.controlUi.allowInsecureAuth=true (token-only auth; skips device pairing)",
        remediation: "Prefer HTTPS (Tailscale Serve) or keep Control UI on loopback.",
      });
    }
  }

  {
    const redactSensitive = readString(getAtPath(cfg, ["logging", "redactSensitive"]));
    if (redactSensitive === "off") {
      findings.push({
        id: "logging.redactSensitive.off",
        severity: "warn",
        title: `${botLabel}Sensitive redaction disabled`,
        detail: `logging.redactSensitive="off"`,
        remediation: `Set logging.redactSensitive="tools" (recommended).`,
      });
    }
  }

  const dmScopeRaw = readString(getAtPath(cfg, ["session", "dmScope"]));
  const dmScope = dmScopeRaw || "main";
  if (dmScopeRaw && dmScope !== "main" && dmScope !== "per-channel-peer" && dmScope !== "per-channel" && dmScope !== "per-peer") {
    findings.push({
      id: "session.dmScope.unknown",
      severity: "warn",
      title: `${botLabel}Unknown DM session scope`,
      detail: `session.dmScope="${dmScopeRaw}"`,
    });
  }

  {
    const groupPolicyRaw = readString(getAtPath(cfg, ["channels", "defaults", "groupPolicy"]));
    const groupPolicy = normalizeGroupPolicy(groupPolicyRaw);
    if (groupPolicyRaw && !groupPolicy) {
      findings.push({
        id: "channels.defaults.groupPolicy.unknown",
        severity: "warn",
        title: `${botLabel}Default group policy looks invalid`,
        detail: `channels.defaults.groupPolicy="${groupPolicyRaw}"`,
      });
    } else if (groupPolicy === "open") {
      findings.push({
        id: "channels.defaults.groupPolicy.open",
        severity: "critical",
        title: `${botLabel}Default group policy is open`,
        detail: `channels.defaults.groupPolicy="open"`,
        remediation: `Set channels.defaults.groupPolicy="allowlist" (recommended).`,
      });
    }
  }

  for (const spec of DM_POLICY_SPECS) {
    const channelCfg = getAtPath(cfg, ["channels", spec.channelId]);
    if (!isChannelEnabled(channelCfg)) continue;

    const policyRaw = readString(getAtPath(cfg, spec.policyPath));
    const policy = normalizeDmPolicy(policyRaw || "pairing");

    const allowFrom = readStringArray(getAtPath(cfg, spec.allowFromPath));
    const allowFromSet = new Set(allowFrom.map((v) => v.trim()).filter(Boolean));
    const hasWildcard = allowFromSet.has("*");
    allowFromSet.delete("*");
    const allowCount = allowFromSet.size;
    const isMultiUserDm = hasWildcard || allowCount > 1;

    if (policyRaw && !policy) {
      findings.push({
        id: `channels.${spec.channelId}.dmPolicy.unknown`,
        severity: "warn",
        title: `${botLabel}${spec.label} DM policy looks invalid`,
        detail: `${spec.policyPath.join(".")}="${policyRaw}"`,
      });
      continue;
    }

    if (policy === "open") {
      findings.push({
        id: `channels.${spec.channelId}.dmPolicy.open`,
        severity: "critical",
        title: `${botLabel}${spec.label} DMs are open to anyone`,
        detail: `${spec.policyPath.join(".")}="open"`,
        remediation: `Use "pairing" or "allowlist" (recommended).`,
      });
      if (!hasWildcard) {
        findings.push({
          id: `channels.${spec.channelId}.dmPolicy.open_missing_wildcard`,
          severity: "critical",
          title: `${botLabel}${spec.label} DM policy misconfigured`,
          detail: `"open" requires ${spec.allowFromPath.join(".")} to include "*"`,
          remediation: `Either add "*" to allowFrom or switch dmPolicy away from "open".`,
        });
      }
    }

    if (dmScope === "main" && isMultiUserDm) {
      findings.push({
        id: `session.dmScope.multi_user_dm`,
        severity: "warn",
        title: `${botLabel}${spec.label} DMs share the main session`,
        detail:
          `session.dmScope="main" with ${spec.allowFromPath.join(".")} allowing multiple senders; risk of cross-user context leakage`,
        remediation: `Set session.dmScope="per-channel-peer".`,
      });
    }
  }

  for (const spec of GROUP_POLICY_SPECS) {
    const channelCfg = getAtPath(cfg, ["channels", spec.channelId]);
    if (!isChannelEnabled(channelCfg)) continue;

    const policyRaw = readString(getAtPath(cfg, spec.policyPath));
    const policy = normalizeGroupPolicy(policyRaw);
    if (policyRaw && !policy) {
      findings.push({
        id: `channels.${spec.channelId}.groupPolicy.unknown`,
        severity: "warn",
        title: `${botLabel}${spec.label} group policy looks invalid`,
        detail: `${spec.policyPath.join(".")}="${policyRaw}"`,
      });
    } else if (policy === "open") {
      findings.push({
        id: `channels.${spec.channelId}.groupPolicy.open`,
        severity: "critical",
        title: `${botLabel}${spec.label} groups are open to anyone`,
        detail: `${spec.policyPath.join(".")}="open"`,
        remediation: `Use "allowlist" (recommended) or "disabled".`,
      });
    }

    const allowFrom = readStringArray(getAtPath(cfg, spec.groupAllowFromPath));
    if (allowFrom.some((v) => v.trim() === "*")) {
      findings.push({
        id: `channels.${spec.channelId}.groupAllowFrom.wildcard`,
        severity: "critical",
        title: `${botLabel}${spec.label} group sender allowlist contains wildcard`,
        detail: `${spec.groupAllowFromPath.join(".")} includes "*" (any group member)`,
        remediation: `Remove "*" and use explicit sender ids/usernames.`,
      });
    }
  }

  return { summary: summarize(findings), findings };
}
