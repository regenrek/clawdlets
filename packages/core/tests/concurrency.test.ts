import { describe, expect, it } from "vitest";

describe("concurrency", () => {
  it("caps concurrency and preserves output order", async () => {
    const { mapWithConcurrency } = await import("../src/lib/concurrency");

    let running = 0;
    let maxRunning = 0;

    const items = [1, 2, 3, 4, 5];
    const out = await mapWithConcurrency({
      items,
      concurrency: 2,
      fn: async (n) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running -= 1;
        return n * 2;
      },
    });

    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });
});

