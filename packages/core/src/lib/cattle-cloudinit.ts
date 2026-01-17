import YAML from "yaml";
import type { CattleTask } from "./cattle-task.js";
import { EnvVarNameSchema } from "./identifiers.js";

export const HCLOUD_USER_DATA_MAX_BYTES = 32 * 1024;

export type CattleCloudInitParams = {
  hostname?: string;
  adminAuthorizedKeys: string[];
  tailscaleAuthKey: string;
  task: CattleTask;
  publicEnv?: Record<string, string>;
  secretsBootstrap?: { baseUrl: string; token: string };
  extraWriteFiles?: Array<{
    path: string;
    permissions: string;
    owner: string;
    content: string;
  }>;
};

const SUPPORTED_PUBLIC_ENV_KEYS = new Set<string>(["CLAWDLETS_CATTLE_AUTO_SHUTDOWN"]);

function normalizePublicEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env || {})) {
    const key = String(k || "").trim();
    if (!key) continue;
    void EnvVarNameSchema.parse(key);
    if (!key.startsWith("CLAWDLETS_")) {
      throw new Error(`cloud-init env not allowed: ${key} (secrets must be fetched at runtime)`);
    }
    if (!SUPPORTED_PUBLIC_ENV_KEYS.has(key)) {
      throw new Error(`cloud-init env not supported: ${key}`);
    }
    out[key] = String(v ?? "");
  }

  if ("CLAWDLETS_CATTLE_AUTO_SHUTDOWN" in out && out.CLAWDLETS_CATTLE_AUTO_SHUTDOWN !== "0" && out.CLAWDLETS_CATTLE_AUTO_SHUTDOWN !== "1") {
    throw new Error(`cloud-init env invalid: CLAWDLETS_CATTLE_AUTO_SHUTDOWN must be 0|1`);
  }
  return out;
}

export function buildCattleCloudInitUserData(params: CattleCloudInitParams): string {
  const hostname = String(params.hostname || "").trim();
  if (hostname && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$/.test(hostname)) {
    throw new Error(`invalid hostname for cloud-init: ${hostname}`);
  }

  const keys = Array.from(new Set(params.adminAuthorizedKeys.map((k) => String(k || "").trim()).filter(Boolean)));
  if (keys.length === 0) throw new Error("adminAuthorizedKeys is empty (need at least 1 SSH public key)");

  const tailscaleAuthKey = String(params.tailscaleAuthKey || "").trim();
  if (!tailscaleAuthKey) throw new Error("tailscaleAuthKey is missing");

  const publicEnv = normalizePublicEnv(params.publicEnv);
  const publicEnvKeys = Object.keys(publicEnv).sort();
  const publicEnvText =
    publicEnvKeys.length === 0
      ? ""
      : `${JSON.stringify(Object.fromEntries(publicEnvKeys.map((k) => [k, publicEnv[k]!] as const)))}\n`;

  const bootstrap = params.secretsBootstrap
    ? {
        baseUrl: String(params.secretsBootstrap.baseUrl || "").trim(),
        token: String(params.secretsBootstrap.token || "").trim(),
      }
    : null;
  if (bootstrap) {
    if (!bootstrap.baseUrl) throw new Error("secretsBootstrap.baseUrl is missing");
    if (!/^https?:\/\//.test(bootstrap.baseUrl)) throw new Error(`secretsBootstrap.baseUrl must be http(s): ${bootstrap.baseUrl}`);
    if (!bootstrap.token) throw new Error("secretsBootstrap.token is missing");
  }

  const writeFiles: any[] = [
    {
      path: "/var/lib/clawdlets/cattle/task.json",
      permissions: "0600",
      owner: "root:root",
      content: `${JSON.stringify({ ...params.task, callbackUrl: "" }, null, 2)}\n`,
    },
    {
      path: "/run/secrets/tailscale_auth_key",
      permissions: "0400",
      owner: "root:root",
      content: `${tailscaleAuthKey}\n`,
    },
    ...(bootstrap
      ? [
          {
            path: "/run/clawdlets/cattle/bootstrap.json",
            permissions: "0400",
            owner: "root:root",
            content: `${JSON.stringify(bootstrap, null, 2)}\n`,
          },
        ]
      : []),
    ...(publicEnvText
      ? [
          {
            path: "/run/clawdlets/cattle/env.public",
            permissions: "0400",
            owner: "root:root",
            content: publicEnvText,
          },
        ]
      : []),
    ...((params.extraWriteFiles || []).map((f) => ({
      path: f.path,
      permissions: f.permissions,
      owner: f.owner,
      content: f.content,
    })) as any[]),
  ];

  const doc = {
    ...(hostname ? { hostname, preserve_hostname: false } : {}),
    users: [
      "default",
      {
        name: "admin",
        groups: ["wheel"],
        lock_passwd: true,
        sudo: "ALL=(ALL) NOPASSWD:ALL",
        shell: "/run/current-system/sw/bin/bash",
        ssh_authorized_keys: keys,
      },
    ],
    write_files: writeFiles,
    runcmd: [
      ["systemctl", "restart", "tailscaled.service"],
      ["systemctl", "restart", "tailscaled-autoconnect.service"],
    ],
  };

  const yaml = YAML.stringify(doc, { lineWidth: 0 });
  const out = `#cloud-config\n${yaml}`;
  const bytes = Buffer.byteLength(out, "utf8");
  if (bytes > HCLOUD_USER_DATA_MAX_BYTES) {
    throw new Error(
      `cloud-init user_data too large: ${bytes} bytes (Hetzner limit ${HCLOUD_USER_DATA_MAX_BYTES}); reduce payload or use orchestrator fetch`,
    );
  }
  return out;
}
