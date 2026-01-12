import fs from "node:fs";
import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { looksLikeSshPrivateKey, parseSshPublicKeysFromText } from "@clawdbot/clawdlets-core/lib/ssh";
import { validateTargetHost } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import {
  assertSafeHostName,
  ClawdletsConfigSchema,
  loadClawdletsConfig,
  resolveHostName,
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

function readSshPublicKeysFromFile(filePath: string): string[] {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  if (stat.size > 64 * 1024) throw new Error(`ssh key file too large (>64KB): ${filePath}`);

  const raw = fs.readFileSync(filePath, "utf8");
  if (looksLikeSshPrivateKey(raw)) {
    throw new Error(`refusing to read ssh private key (expected .pub): ${filePath}`);
  }

  const keys = parseSshPublicKeysFromText(raw);
  if (keys.length === 0) throw new Error(`no ssh public keys found in file: ${filePath}`);
  return keys;
}

function toStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
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
      flakeHost: "",
      targetHost: undefined,
      hetzner: { serverType: "cx43" },
      opentofu: { adminCidr: "", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
      publicSsh: { enable: false },
      provisioning: { enable: false },
      tailnet: { mode: "tailscale" },
      agentModelPrimary: "zai/glm-4.7",
    };

    const next = ClawdletsConfigSchema.parse({
      ...config,
      defaultHost: config.defaultHost || hostName,
      hosts: { ...config.hosts, [hostName]: nextHost },
    });
    await writeClawdletsConfig({ configPath, config: next });
    console.log(`ok: added host ${hostName}`);
  },
});

const setDefault = defineCommand({
  meta: { name: "set-default", description: "Set config.defaultHost (default host used when --host is omitted)." },
  args: {
    host: { type: "string", description: "Host name (defaults to current defaultHost / sole host)." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });

    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      console.error(`warn: ${resolved.message}`);
      for (const t of resolved.tips) console.error(`tip: ${t}`);
      process.exitCode = 1;
      return;
    }

    const next = ClawdletsConfigSchema.parse({ ...config, defaultHost: resolved.host });
    await writeClawdletsConfig({ configPath, config: next });
    console.log(`ok: defaultHost = ${resolved.host}`);
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set host config fields (in infra/configs/clawdlets.json)." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    enable: { type: "string", description: "Enable fleet services (true/false)." },
    "public-ssh": { type: "string", description: "Public SSH (true/false; not recommended)." },
    provisioning: { type: "string", description: "Provisioning mode (true/false; relaxes validation)." },
    "disk-device": { type: "string", description: "Disk device (e.g. /dev/disk/by-id/...).", },
    "agent-model-primary": { type: "string", description: "Primary agent model (e.g. zai/glm-4.7)." },
    tailnet: { type: "string", description: "Tailnet mode: none|tailscale." },
    "flake-host": { type: "string", description: "Flake output host name override (default: same as host name)." },
    "target-host": { type: "string", description: "SSH target (ssh config alias or user@host)." },
    "server-type": { type: "string", description: "Hetzner server type (e.g. cx43)." },
    "admin-cidr": { type: "string", description: "ADMIN_CIDR (e.g. 1.2.3.4/32)." },
    "ssh-pubkey-file": { type: "string", description: "SSH_PUBKEY_FILE path (e.g. ~/.ssh/id_ed25519.pub)." },
    "clear-ssh-keys": { type: "boolean", description: "Clear sshAuthorizedKeys.", default: false },
    "add-ssh-key": { type: "string", description: "Add SSH public key contents (repeatable).", array: true },
    "add-ssh-key-file": { type: "string", description: "Add SSH public key from file (repeatable).", array: true },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });

    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      console.error(`warn: ${resolved.message}`);
      for (const t of resolved.tips) console.error(`tip: ${t}`);
      process.exitCode = 1;
      return;
    }

    const hostName = resolved.host;
    const existing = config.hosts[hostName];
    if (!existing) {
      console.error(`warn: unknown host in clawdlets.json: ${hostName}`);
      console.error(`tip: available hosts: ${Object.keys(config.hosts).join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const next: ClawdletsHostConfig = structuredClone(existing) as ClawdletsHostConfig;

    const enable = parseBoolOrUndefined(args.enable);
    if (enable !== undefined) next.enable = enable;

    const publicSsh = parseBoolOrUndefined((args as any)["public-ssh"]);
    if (publicSsh !== undefined) next.publicSsh.enable = publicSsh;

    const provisioning = parseBoolOrUndefined((args as any).provisioning);
    if (provisioning !== undefined) next.provisioning.enable = provisioning;

    if ((args as any)["disk-device"] !== undefined) next.diskDevice = String((args as any)["disk-device"]).trim();
    if ((args as any)["agent-model-primary"] !== undefined) next.agentModelPrimary = String((args as any)["agent-model-primary"]).trim();

    if ((args as any)["flake-host"] !== undefined) next.flakeHost = String((args as any)["flake-host"]).trim();

    if ((args as any)["target-host"] !== undefined) {
      const v = String((args as any)["target-host"]).trim();
      next.targetHost = v ? validateTargetHost(v) : undefined;
    }

    if ((args as any)["server-type"] !== undefined) next.hetzner.serverType = String((args as any)["server-type"]).trim();
    if ((args as any)["admin-cidr"] !== undefined) next.opentofu.adminCidr = String((args as any)["admin-cidr"]).trim();
    if ((args as any)["ssh-pubkey-file"] !== undefined) next.opentofu.sshPubkeyFile = String((args as any)["ssh-pubkey-file"]).trim();

    if (args.tailnet !== undefined) {
      const mode = String(args.tailnet).trim();
      if (mode !== "none" && mode !== "tailscale") {
        throw new Error("invalid --tailnet (expected none|tailscale)");
      }
      next.tailnet.mode = mode;
    }

    if ((args as any)["clear-ssh-keys"]) next.sshAuthorizedKeys = [];
    {
      const keys = new Set<string>(next.sshAuthorizedKeys || []);

      for (const file of toStringArray((args as any)["add-ssh-key-file"])) {
        for (const k of readSshPublicKeysFromFile(file)) keys.add(k);
      }

      for (const raw of toStringArray((args as any)["add-ssh-key"])) {
        if (!raw.trim()) continue;
        if (looksLikeSshPrivateKey(raw)) {
          throw new Error("refusing to add ssh private key (expected public key contents)");
        }
        const parsed = parseSshPublicKeysFromText(raw);
        if (parsed.length === 0) throw new Error("invalid --add-ssh-key (expected ssh public key contents)");
        for (const k of parsed) keys.add(k);
      }

      next.sshAuthorizedKeys = Array.from(keys);
    }

    const nextConfig = ClawdletsConfigSchema.parse({ ...config, hosts: { ...config.hosts, [hostName]: next } });
    await writeClawdletsConfig({ configPath, config: nextConfig });
    console.log(`ok: updated host ${hostName}`);
  },
});

export const host = defineCommand({
  meta: { name: "host", description: "Manage host config (infra/configs/clawdlets.json)." },
  subCommands: { add, "set-default": setDefault, set },
});
