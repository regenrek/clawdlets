import { afterEach, describe, expect, it, vi } from "vitest";

const listHcloudServersMock = vi.fn();
const deleteHcloudServerMock = vi.fn();

vi.mock("../src/lib/hcloud.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hcloud.js")>();
  return {
    ...actual,
    listHcloudServers: listHcloudServersMock,
    deleteHcloudServer: deleteHcloudServerMock,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("reapExpiredCattle", () => {
  it("deletes with bounded concurrency", async () => {
    const { reapExpiredCattle } = await import("../src/lib/hcloud-cattle");
    const now = new Date(1_700_000_000_000);
    const nowSec = Math.floor(now.getTime() / 1000);

    listHcloudServersMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `cattle-${i + 1}`,
        status: "running",
        created: new Date((nowSec - 1000) * 1000).toISOString(),
        labels: {
          "managed-by": "clawdlets",
          cattle: "true",
          "created-at": String(nowSec - 1000),
          "expires-at": String(nowSec - 1),
        },
        public_net: { ipv4: { ip: "" } },
      })),
    );

    let active = 0;
    let maxActive = 0;
    deleteHcloudServerMock.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });

    const res = await reapExpiredCattle({ token: "token", now, concurrency: 3 });
    expect(res.deletedIds).toHaveLength(10);
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
