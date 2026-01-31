import type { ClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";

export const baseHost = {
  enable: false,
  diskDevice: "/dev/sda",
  flakeHost: "",
  targetHost: "admin@host",
  hetzner: { serverType: "cx43", image: "", location: "nbg1" },
  provisioning: { adminCidr: "203.0.113.1/32", adminCidrAllowWorldOpen: false, sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
  sshExposure: { mode: "bootstrap" },
  tailnet: { mode: "tailscale" },
  cache: {
    substituters: ["https://cache.nixos.org", "https://cache.garnix.io"],
    trustedPublicKeys: [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
      "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
    ],
    netrc: { enable: false, secretName: "garnix_netrc", path: "/etc/nix/netrc", narinfoCachePositiveTtl: 3600 },
  },
  operator: { deploy: { enable: false } },
  selfUpdate: {
    enable: false,
    interval: "30min",
    baseUrl: "",
    channel: "prod",
    publicKeys: [],
    allowUnsigned: false,
    allowRollback: false,
    healthCheckUnit: "",
  },
  agentModelPrimary: "zai/glm-4.7",
} as const;

export function makeConfig(params?: {
  hostName?: string;
  hostOverrides?: Partial<typeof baseHost>;
  fleetOverrides?: Record<string, unknown>;
}): ClawdletsConfig {
  const hostName = params?.hostName ?? "alpha";
  const host = { ...baseHost, ...(params?.hostOverrides ?? {}) };
  const fleet = {
    secretEnv: {},
    secretFiles: {},
    sshAuthorizedKeys: [] as string[],
    sshKnownHosts: [] as string[],
    botOrder: [] as string[],
    bots: {} as Record<string, unknown>,
    codex: { enable: false, bots: [] },
    backups: { restic: { enable: false, repository: "" } },
    ...(params?.fleetOverrides ?? {}),
  };
  return {
    schemaVersion: 11,
    defaultHost: hostName,
    fleet,
    hosts: { [hostName]: host } as Record<string, typeof host>,
  } as ClawdletsConfig;
}
