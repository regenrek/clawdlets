import YAML from "yaml";
import { formatDotenvValue } from "./dotenv-file.js";
import type { CattleTask } from "./cattle-task.js";

export const HCLOUD_USER_DATA_MAX_BYTES = 32 * 1024;

export type CattleCloudInitParams = {
  hostname?: string;
  adminAuthorizedKeys: string[];
  tailscaleAuthKey: string;
  task: CattleTask;
  env?: Record<string, string>;
  extraWriteFiles?: Array<{
    path: string;
    permissions: string;
    owner: string;
    content: string;
  }>;
};

function toEnvFileText(env: Record<string, string> | undefined): string {
  const entries = Object.entries(env || {})
    .map(([k, v]) => [String(k || "").trim(), String(v ?? "")] as const)
    .filter(([k]) => Boolean(k));
  if (entries.length === 0) return "";
  return `${entries.map(([k, v]) => `${k}=${formatDotenvValue(v)}`).join("\n")}\n`;
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

  const envText = toEnvFileText(params.env);

  const writeFiles: any[] = [
    {
      path: "/var/lib/clawdlets/cattle/task.json",
      permissions: "0600",
      owner: "root:root",
      content: `${JSON.stringify(params.task, null, 2)}\n`,
    },
    {
      path: "/run/secrets/tailscale_auth_key",
      permissions: "0400",
      owner: "root:root",
      content: `${tailscaleAuthKey}\n`,
    },
    ...(envText
      ? [
          {
            path: "/run/clawdlets/cattle/env",
            permissions: "0400",
            owner: "root:root",
            content: envText,
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
