import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const runMainMock = vi.fn();
const defineCommandMock = vi.fn((cmd) => cmd);

vi.mock("citty", () => ({
  defineCommand: defineCommandMock,
  runMain: runMainMock,
}));

describe("clf main", () => {
  let argv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    argv = process.argv.slice();
  });

  afterEach(() => {
    process.argv = argv;
  });

  it("strips standalone -- and runs main", async () => {
    process.argv = ["node", "clf", "jobs", "--", "extra"];
    await import("../src/main");
    expect(process.argv).toEqual(["node", "clf", "jobs", "extra"]);
    expect(runMainMock).toHaveBeenCalledTimes(1);
  });
});
