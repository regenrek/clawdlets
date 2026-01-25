export const FLEET_WORKSPACE_MANAGED_DOCS = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "TOOLS.md",
  "USER.md",
  "HEARTBEAT.md",
] as const;

export type FleetWorkspaceManagedDoc = (typeof FLEET_WORKSPACE_MANAGED_DOCS)[number];

export const FLEET_WORKSPACE_OPTIONAL_DOCS = ["BOOT.md", "BOOTSTRAP.md", "MEMORY.md"] as const;

export type FleetWorkspaceOptionalDoc = (typeof FLEET_WORKSPACE_OPTIONAL_DOCS)[number];

export const FLEET_WORKSPACE_EDITABLE_DOCS = [
  ...FLEET_WORKSPACE_MANAGED_DOCS,
  ...FLEET_WORKSPACE_OPTIONAL_DOCS,
] as const;

export type FleetWorkspaceEditableDoc = (typeof FLEET_WORKSPACE_EDITABLE_DOCS)[number];

export function isFleetWorkspaceEditableDoc(name: string): name is FleetWorkspaceEditableDoc {
  return (FLEET_WORKSPACE_EDITABLE_DOCS as readonly string[]).includes(name);
}

