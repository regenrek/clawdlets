export type ClawdbotSecurityDefaultsChange = {
  path: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isPlainObject(existing)) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function setValue(params: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
  pathLabel: string;
  changes: ClawdbotSecurityDefaultsChange[];
}): void {
  const existing = params.obj[params.key];
  if (existing === params.value) return;
  params.obj[params.key] = params.value;
  params.changes.push({ path: params.pathLabel });
}

function isEnabledChannel(channelCfg: unknown): boolean {
  if (!isPlainObject(channelCfg)) return false;
  return channelCfg["enabled"] !== false;
}

export function applySecurityDefaults(params: {
  clawdbot: unknown;
}): { clawdbot: Record<string, unknown>; warnings: string[]; changes: ClawdbotSecurityDefaultsChange[] } {
  const base = isPlainObject(params.clawdbot) ? params.clawdbot : {};
  const clawdbot = structuredClone(base) as Record<string, unknown>;
  const warnings: string[] = [];
  const changes: ClawdbotSecurityDefaultsChange[] = [];

  {
    const logging = ensureObject(clawdbot, "logging");
    const redactSensitive = typeof logging["redactSensitive"] === "string" ? String(logging["redactSensitive"]).trim() : "";
    if (!redactSensitive || redactSensitive === "off") {
      setValue({
        obj: logging,
        key: "redactSensitive",
        value: "tools",
        pathLabel: "logging.redactSensitive",
        changes,
      });
    }
  }

  {
    const session = ensureObject(clawdbot, "session");
    const dmScope = typeof session["dmScope"] === "string" ? String(session["dmScope"]).trim() : "";
    if (!dmScope || dmScope === "main") {
      setValue({
        obj: session,
        key: "dmScope",
        value: "per-channel-peer",
        pathLabel: "session.dmScope",
        changes,
      });
    }
  }

  const channelsValue = clawdbot["channels"];
  if (!isPlainObject(channelsValue)) return { clawdbot, warnings, changes };
  const channels = channelsValue as Record<string, unknown>;

  const setDmPolicy = (params: {
    channelId: string;
    policyKey: string;
    allowFromKey: string;
    label: string;
  }) => {
    const cfg = channels[params.channelId];
    if (!isEnabledChannel(cfg)) return;
    const chan = cfg as Record<string, unknown>;
    const policyRaw = typeof chan[params.policyKey] === "string" ? String(chan[params.policyKey]).trim() : "";
    let policyNext = policyRaw;
    if (!policyRaw || policyRaw === "open") {
      policyNext = "pairing";
      setValue({
        obj: chan,
        key: params.policyKey,
        value: policyNext,
        pathLabel: `channels.${params.channelId}.${params.policyKey}`,
        changes,
      });
      if (policyRaw === "open") warnings.push(`${params.label}: changed dmPolicy from "open" to "pairing" (safer default).`);
    } else {
      policyNext = policyRaw;
    }

    const allowFrom = Array.isArray(chan[params.allowFromKey]) ? (chan[params.allowFromKey] as unknown[]) : [];
    const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");
    if (hasWildcard && policyNext !== "open") {
      warnings.push(`${params.label}: allowFrom contains "*" (anyone) while dmPolicy is not "open". Review allowlist.`);
    }
  };

  setDmPolicy({ channelId: "telegram", label: "Telegram", policyKey: "dmPolicy", allowFromKey: "allowFrom" });
  setDmPolicy({ channelId: "whatsapp", label: "WhatsApp", policyKey: "dmPolicy", allowFromKey: "allowFrom" });
  setDmPolicy({ channelId: "signal", label: "Signal", policyKey: "dmPolicy", allowFromKey: "allowFrom" });
  setDmPolicy({ channelId: "imessage", label: "iMessage", policyKey: "dmPolicy", allowFromKey: "allowFrom" });
  setDmPolicy({ channelId: "bluebubbles", label: "BlueBubbles", policyKey: "dmPolicy", allowFromKey: "allowFrom" });

  const setGroupPolicy = (params: { channelId: string; label: string }) => {
    const cfg = channels[params.channelId];
    if (!isEnabledChannel(cfg)) return;
    const chan = cfg as Record<string, unknown>;
    const policyRaw = typeof chan["groupPolicy"] === "string" ? String(chan["groupPolicy"]).trim() : "";
    const allowFrom = Array.isArray(chan["groupAllowFrom"]) ? (chan["groupAllowFrom"] as unknown[]) : [];
    const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");

    if (!policyRaw || policyRaw === "open") {
      setValue({
        obj: chan,
        key: "groupPolicy",
        value: "allowlist",
        pathLabel: `channels.${params.channelId}.groupPolicy`,
        changes,
      });
      if (policyRaw === "open") warnings.push(`${params.label}: changed groupPolicy from "open" to "allowlist" (safer default).`);
    }

    if (hasWildcard) warnings.push(`${params.label}: groupAllowFrom contains "*" (any group member). Review allowlist.`);
  };

  setGroupPolicy({ channelId: "telegram", label: "Telegram" });
  setGroupPolicy({ channelId: "whatsapp", label: "WhatsApp" });
  setGroupPolicy({ channelId: "signal", label: "Signal" });
  setGroupPolicy({ channelId: "imessage", label: "iMessage" });
  setGroupPolicy({ channelId: "bluebubbles", label: "BlueBubbles" });

  {
    const cfg = channels["discord"];
    if (isEnabledChannel(cfg)) {
      const discord = cfg as Record<string, unknown>;
      setGroupPolicy({ channelId: "discord", label: "Discord" });
      const dm = ensureObject(discord, "dm");
      const policyRaw = typeof dm["policy"] === "string" ? String(dm["policy"]).trim() : "";
      let policyNext = policyRaw;
      if (!policyRaw || policyRaw === "open") {
        policyNext = "pairing";
        setValue({
          obj: dm,
          key: "policy",
          value: policyNext,
          pathLabel: "channels.discord.dm.policy",
          changes,
        });
        if (policyRaw === "open") warnings.push(`Discord: changed dm.policy from "open" to "pairing" (safer default).`);
      } else {
        policyNext = policyRaw;
      }
      const allowFrom = Array.isArray(dm["allowFrom"]) ? (dm["allowFrom"] as unknown[]) : [];
      const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");
      if (hasWildcard && policyNext !== "open") warnings.push(`Discord: dm.allowFrom contains "*" (anyone). Review allowlist.`);
    }
  }

  {
    const cfg = channels["slack"];
    if (isEnabledChannel(cfg)) {
      const slack = cfg as Record<string, unknown>;
      setGroupPolicy({ channelId: "slack", label: "Slack" });
      const dm = ensureObject(slack, "dm");
      const policyRaw = typeof dm["policy"] === "string" ? String(dm["policy"]).trim() : "";
      let policyNext = policyRaw;
      if (!policyRaw || policyRaw === "open") {
        policyNext = "pairing";
        setValue({
          obj: dm,
          key: "policy",
          value: policyNext,
          pathLabel: "channels.slack.dm.policy",
          changes,
        });
        if (policyRaw === "open") warnings.push(`Slack: changed dm.policy from "open" to "pairing" (safer default).`);
      } else {
        policyNext = policyRaw;
      }
      const allowFrom = Array.isArray(dm["allowFrom"]) ? (dm["allowFrom"] as unknown[]) : [];
      const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");
      if (hasWildcard && policyNext !== "open") warnings.push(`Slack: dm.allowFrom contains "*" (anyone). Review allowlist.`);
    }
  }

  return { clawdbot, warnings, changes };
}
