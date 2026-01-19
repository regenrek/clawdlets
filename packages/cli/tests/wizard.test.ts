import { describe, expect, it, vi, beforeEach } from "vitest";

const { selectMock, cancelMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: selectMock,
  cancel: cancelMock,
  isCancel: (v: unknown) => v === "__CANCEL__",
}));

describe("wizard helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isNav detects nav symbols", async () => {
    const { isNav, NAV_BACK, NAV_EXIT } = await import("../src/lib/wizard.js");
    expect(isNav(NAV_BACK)).toBe(true);
    expect(isNav(NAV_EXIT)).toBe(true);
    expect(isNav("nope")).toBe(false);
  });

  it("navOnCancel returns exit on cancel", async () => {
    const { navOnCancel, NAV_EXIT } = await import("../src/lib/wizard.js");
    selectMock.mockResolvedValue("__CANCEL__");
    const nav = await navOnCancel({ flow: "test", canBack: true });
    expect(nav).toBe(NAV_EXIT);
  });

  it("navOnCancel returns back when selected", async () => {
    const { navOnCancel, NAV_BACK } = await import("../src/lib/wizard.js");
    selectMock.mockResolvedValue("back");
    const nav = await navOnCancel({ flow: "test", canBack: true });
    expect(nav).toBe(NAV_BACK);
  });

  it("cancelFlow calls prompts cancel", async () => {
    const { cancelFlow } = await import("../src/lib/wizard.js");
    cancelFlow();
    expect(cancelMock).toHaveBeenCalled();
  });
});
