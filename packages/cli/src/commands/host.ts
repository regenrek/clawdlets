import fs from "node:fs";
import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { looksLikeSshPrivateKey, parseSshPublicKeysFromText } from "@clawdlets/core/lib/ssh";
import { validateTargetHost } from "@clawdlets/core/lib/ssh-remote";
import {
  assertSafeHostName,
  ClawdletsConfigSchema,
  SSH_EXPOSURE_MODES,
  loadClawdletsConfig,
  resolveHostName,
  writeClawdletsConfig,
  type ClawdletsHostConfig,
} from "@clawdlets/core/lib/clawdlets-config";

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

function readKnownHostsFromFile(filePath: string): string[] {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  if (stat.size > 256 * 1024) throw new Error(`known_hosts file too large (>256KB): ${filePath}`);

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) throw new Error(`no known_hosts entries found in file: ${filePath}`);
  return lines;
}

function toStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

const add = defineCommand({
  meta: { name: "add", description: "Add a host entry to fleet/clawdlets.json." },
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
      diskDevice: "/dev/sda",
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      flakeHost: "",
      targetHost: undefined,
      hetzner: { serverType: "cx43", image: "", location: "nbg1" },
      provisioning: { adminCidr: "", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "tailscale" },
      cache: {
        garnix: {
          private: {
            enable: true,
            netrcSecret: "garnix_netrc",
            netrcPath: "/etc/nix/netrc",
            narinfoCachePositiveTtl: 3600,
          },
        },
      },
      operator: { deploy: { enable: false } },
      selfUpdate: { enable: false, manifestUrl: "", interval: "30min", publicKey: "", signatureUrl: "" },
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
  meta: { name: "set", description: "Set host config fields (in fleet/clawdlets.json)." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    enable: { type: "string", description: "Enable fleet services (true/false)." },
    "ssh-exposure": { type: "string", description: "SSH exposure mode: tailnet|bootstrap|public." },
    "disk-device": { type: "string", description: "Disk device (Hetzner Cloud: /dev/sda).", },
    "agent-model-primary": { type: "string", description: "Primary agent model (e.g. zai/glm-4.7)." },
    tailnet: { type: "string", description: "Tailnet mode: none|tailscale." },
    "garnix-private-cache": { type: "string", description: "Enable private Garnix cache access (true/false). Requires garnix netrc secret.", },
    "garnix-netrc-secret": { type: "string", description: "Sops secret name containing /etc/nix/netrc (default: garnix_netrc).", },
    "garnix-netrc-path": { type: "string", description: "Filesystem path for netrc on host (default: /etc/nix/netrc).", },
    "garnix-narinfo-cache-positive-ttl": { type: "string", description: "narinfo-cache-positive-ttl when private cache enabled (default: 3600).", },
    "flake-host": { type: "string", description: "Flake output host name override (default: same as host name)." },
    "target-host": { type: "string", description: "SSH target (ssh config alias or user@host)." },
    "server-type": { type: "string", description: "Hetzner server type (e.g. cx43)." },
    "hetzner-image": { type: "string", description: "Hetzner image ID/name (custom image or snapshot)." },
    "hetzner-location": { type: "string", description: "Hetzner location (e.g. nbg1, fsn1)." },
    "admin-cidr": { type: "string", description: "ADMIN_CIDR (e.g. 1.2.3.4/32)." },
    "ssh-pubkey-file": { type: "string", description: "SSH_PUBKEY_FILE path (e.g. ~/.ssh/id_ed25519.pub)." },
    "clear-ssh-keys": { type: "boolean", description: "Clear sshAuthorizedKeys.", default: false },
    "add-ssh-key": { type: "string", description: "Add SSH public key contents (repeatable).", array: true },
    "add-ssh-key-file": { type: "string", description: "Add SSH public key from file (repeatable).", array: true },
    "clear-ssh-known-hosts": { type: "boolean", description: "Clear sshKnownHosts.", default: false },
    "add-ssh-known-host": { type: "string", description: "Add known_hosts entry (repeatable).", array: true },
    "add-ssh-known-host-file": { type: "string", description: "Add known_hosts entries from file (repeatable).", array: true },
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

    if ((args as any)["ssh-exposure"] !== undefined) {
      const mode = String((args as any)["ssh-exposure"]).trim();
      if (!SSH_EXPOSURE_MODES.includes(mode as (typeof SSH_EXPOSURE_MODES)[number])) {
        throw new Error("invalid --ssh-exposure (expected tailnet|bootstrap|public)");
      }
      next.sshExposure.mode = mode as (typeof SSH_EXPOSURE_MODES)[number];
    }

    if ((args as any)["disk-device"] !== undefined) next.diskDevice = String((args as any)["disk-device"]).trim();
    if ((args as any)["agent-model-primary"] !== undefined) next.agentModelPrimary = String((args as any)["agent-model-primary"]).trim();

    if ((args as any)["garnix-private-cache"] !== undefined) {
      const v = parseBoolOrUndefined((args as any)["garnix-private-cache"]);
      if (v !== undefined) next.cache.garnix.private.enable = v;
    }
    if ((args as any)["garnix-netrc-secret"] !== undefined) next.cache.garnix.private.netrcSecret = String((args as any)["garnix-netrc-secret"]).trim();
    if ((args as any)["garnix-netrc-path"] !== undefined) next.cache.garnix.private.netrcPath = String((args as any)["garnix-netrc-path"]).trim();
    if ((args as any)["garnix-narinfo-cache-positive-ttl"] !== undefined) {
      const raw = String((args as any)["garnix-narinfo-cache-positive-ttl"]).trim();
      if (raw) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) throw new Error("invalid --garnix-narinfo-cache-positive-ttl (expected positive integer)");
        next.cache.garnix.private.narinfoCachePositiveTtl = n;
      }
    }

    if ((args as any)["flake-host"] !== undefined) next.flakeHost = String((args as any)["flake-host"]).trim();

    if ((args as any)["target-host"] !== undefined) {
      const v = String((args as any)["target-host"]).trim();
      next.targetHost = v ? validateTargetHost(v) : undefined;
    }

    if ((args as any)["server-type"] !== undefined) next.hetzner.serverType = String((args as any)["server-type"]).trim();
    if ((args as any)["hetzner-image"] !== undefined) next.hetzner.image = String((args as any)["hetzner-image"]).trim();
    if ((args as any)["hetzner-location"] !== undefined) next.hetzner.location = String((args as any)["hetzner-location"]).trim();
    if ((args as any)["admin-cidr"] !== undefined) next.provisioning.adminCidr = String((args as any)["admin-cidr"]).trim();
    if ((args as any)["ssh-pubkey-file"] !== undefined) next.provisioning.sshPubkeyFile = String((args as any)["ssh-pubkey-file"]).trim();

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

    if ((args as any)["clear-ssh-known-hosts"]) next.sshKnownHosts = [];
    {
      const knownHosts = new Set<string>(next.sshKnownHosts || []);

      for (const file of toStringArray((args as any)["add-ssh-known-host-file"])) {
        for (const line of readKnownHostsFromFile(file)) knownHosts.add(line);
      }

      for (const raw of toStringArray((args as any)["add-ssh-known-host"])) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("#")) continue;
        knownHosts.add(trimmed);
      }

      next.sshKnownHosts = Array.from(knownHosts);
    }

    const nextConfig = ClawdletsConfigSchema.parse({ ...config, hosts: { ...config.hosts, [hostName]: next } });
    await writeClawdletsConfig({ configPath, config: nextConfig });
    console.log(`ok: updated host ${hostName}`);
  },
});

export const host = defineCommand({
  meta: { name: "host", description: "Manage host config (fleet/clawdlets.json)." },
  subCommands: { add, "set-default": setDefault, set },
});
