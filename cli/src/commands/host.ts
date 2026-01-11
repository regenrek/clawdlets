import fs from "node:fs";
import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import {
  assertSafeHostName,
  ClawdletsConfigSchema,
  loadClawdletsConfig,
  writeClawdletsConfig,
  type ClawdletsHostConfig,
} from "@clawdbot/clawdlets-core/lib/clawdlets-config";

function parseBoolOrUndefined(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "") return undefined;
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  throw new Error(`invalid boolean: ${String(v)} (use true/false)`);
}

function readFileTrimmed(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.trim();
}

const add = defineCommand({
  meta: { name: "add", description: "Add a host entry to infra/configs/clawdlets.json." },
  args: {
    host: { type: "string", description: "Host name." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });
    const hostName = String(args.host || "").trim();
    if (!hostName) throw new Error("missing --host");
    assertSafeHostName(hostName);
    if (config.hosts[hostName]) throw new Error(`host already exists in clawdlets.json: ${hostName}`);

    const nextHost: ClawdletsHostConfig = {
      enable: false,
      diskDevice: "/dev/disk/by-id/CHANGE_ME",
      sshAuthorizedKeys: [],
      publicSsh: { enable: false },
      provisioning: { enable: false },
      tailnet: { mode: "tailscale" },
      agentModelPrimary: "zai/glm-4.7",
    };

    const next = ClawdletsConfigSchema.parse({ ...config, hosts: { ...config.hosts, [hostName]: nextHost } });
    await writeClawdletsConfig({ configPath, config: next });
    console.log(`ok: added host ${hostName}`);
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set host config fields (in infra/configs/clawdlets.json)." },
  args: {
    host: { type: "string", description: "Host name.", default: "clawdbot-fleet-host" },
    enable: { type: "string", description: "Enable fleet services (true/false)." },
    "public-ssh": { type: "string", description: "Public SSH (true/false; not recommended)." },
    provisioning: { type: "string", description: "Provisioning mode (true/false; relaxes validation)." },
    "disk-device": { type: "string", description: "Disk device (e.g. /dev/disk/by-id/...).", },
    "agent-model-primary": { type: "string", description: "Primary agent model (e.g. zai/glm-4.7)." },
    tailnet: { type: "string", description: "Tailnet mode: none|tailscale." },
    "clear-ssh-keys": { type: "boolean", description: "Clear sshAuthorizedKeys.", default: false },
    "add-ssh-key": { type: "string", description: "Add SSH public key contents (repeatable).", array: true },
    "add-ssh-key-file": { type: "string", description: "Add SSH public key from file (repeatable).", array: true },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });

    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    assertSafeHostName(hostName);
    const existing = config.hosts[hostName];
    if (!existing) throw new Error(`unknown host in clawdlets.json: ${hostName}`);

    const next: ClawdletsHostConfig = JSON.parse(JSON.stringify(existing)) as ClawdletsHostConfig;

    const enable = parseBoolOrUndefined(args.enable);
    if (enable !== undefined) next.enable = enable;

    const publicSsh = parseBoolOrUndefined((args as any)["public-ssh"]);
    if (publicSsh !== undefined) next.publicSsh.enable = publicSsh;

    const provisioning = parseBoolOrUndefined((args as any).provisioning);
    if (provisioning !== undefined) next.provisioning.enable = provisioning;

    if ((args as any)["disk-device"] !== undefined) next.diskDevice = String((args as any)["disk-device"]).trim();
    if ((args as any)["agent-model-primary"] !== undefined) next.agentModelPrimary = String((args as any)["agent-model-primary"]).trim();

    if (args.tailnet !== undefined) {
      const mode = String(args.tailnet).trim();
      if (mode !== "none" && mode !== "tailscale") {
        throw new Error("invalid --tailnet (expected none|tailscale)");
      }
      next.tailnet.mode = mode;
    }

    if ((args as any)["clear-ssh-keys"]) next.sshAuthorizedKeys = [];
    for (const file of (((args as any)["add-ssh-key-file"] || []) as string[])) {
      const v = readFileTrimmed(String(file));
      if (v) next.sshAuthorizedKeys = Array.from(new Set([...next.sshAuthorizedKeys, v]));
    }
    for (const k of (((args as any)["add-ssh-key"] || []) as string[])) {
      const v = String(k).trim();
      if (v) next.sshAuthorizedKeys = Array.from(new Set([...next.sshAuthorizedKeys, v]));
    }

    const nextConfig = ClawdletsConfigSchema.parse({ ...config, hosts: { ...config.hosts, [hostName]: next } });
    await writeClawdletsConfig({ configPath, config: nextConfig });
    console.log(`ok: updated host ${hostName}`);
  },
});

export const host = defineCommand({
  meta: { name: "host", description: "Manage host config (infra/configs/clawdlets.json)." },
  subCommands: { add, set },
});
