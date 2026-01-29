export const RUN_KINDS = [
  "project_init",
  "project_import",
  "config_write",
  "workspace_write",
  "doctor",
  "secrets_init",
  "secrets_verify",
  "secrets_sync",
  "bootstrap",
  "lockdown",
  "deploy",
  "server_status",
  "server_logs",
  "server_audit",
  "server_channels",
  "server_restart",
  "custom",
] as const;

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"] as const;

export const RUN_EVENT_LEVELS = ["debug", "info", "warn", "error"] as const;
