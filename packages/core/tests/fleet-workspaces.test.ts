import { describe, it, expect } from "vitest";

describe("fleet-workspaces", () => {
  it("recognizes editable docs and rejects others", async () => {
    const { isFleetWorkspaceEditableDoc, FLEET_WORKSPACE_EDITABLE_DOCS } = await import("../src/lib/fleet-workspaces");
    expect(isFleetWorkspaceEditableDoc("AGENTS.md")).toBe(true);
    expect(isFleetWorkspaceEditableDoc("SOUL.md")).toBe(true);
    expect(isFleetWorkspaceEditableDoc("BOOT.md")).toBe(true);
    expect(isFleetWorkspaceEditableDoc("MEMORY.md")).toBe(true);

    expect(isFleetWorkspaceEditableDoc("memory/2026-01-01.md")).toBe(false);
    expect(isFleetWorkspaceEditableDoc("../pwn")).toBe(false);
    expect(isFleetWorkspaceEditableDoc("AGENTS.MD")).toBe(false);

    expect(FLEET_WORKSPACE_EDITABLE_DOCS).toContain("AGENTS.md");
    expect(FLEET_WORKSPACE_EDITABLE_DOCS).toContain("USER.md");
  });
});

