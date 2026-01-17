import { afterEach, describe, expect, it, vi } from "vitest";

const listHcloudServersMock = vi.fn();
const deleteHcloudServerMock = vi.fn();
const ensureHcloudFirewallIdMock = vi.fn();
const createHcloudServerMock = vi.fn();
const waitForHcloudServerStatusMock = vi.fn();

vi.mock("../src/lib/hcloud.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hcloud.js")>();
  return {
    ...actual,
    listHcloudServers: listHcloudServersMock,
    deleteHcloudServer: deleteHcloudServerMock,
    ensureHcloudFirewallId: ensureHcloudFirewallIdMock,
    createHcloudServer: createHcloudServerMock,
    waitForHcloudServerStatus: waitForHcloudServerStatusMock,
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
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

describe("listExpiredCattle", () => {
  it("treats malformed expires-at labels as expired (never-reap hardening)", async () => {
    const { listExpiredCattle } = await import("../src/lib/hcloud-cattle");
    const now = new Date(1_700_000_000_000);
    const nowSec = Math.floor(now.getTime() / 1000);

    listHcloudServersMock.mockResolvedValue([
      {
        id: 1,
        name: "cattle-bad-exp",
        status: "running",
        created: new Date((nowSec - 1000) * 1000).toISOString(),
        labels: {
          "managed-by": "clawdlets",
          cattle: "true",
          "created-at": String(nowSec - 1000),
          "expires-at": "not-a-number",
        },
        public_net: { ipv4: { ip: "" } },
      },
    ]);

    const expired = await listExpiredCattle({ token: "token", now });
    expect(expired.map((s) => s.name)).toEqual(["cattle-bad-exp"]);
  });
});

describe("createCattleServer", () => {
  it("caches firewall id between spawns", async () => {
    const { createCattleServer } = await import("../src/lib/hcloud-cattle");

    ensureHcloudFirewallIdMock.mockResolvedValue("99");
    createHcloudServerMock.mockImplementation(async (params: any) => ({
      id: 1,
      name: String(params.name),
      status: "running",
      created: new Date("2026-01-01T00:00:00Z").toISOString(),
      labels: params.labels || {},
      public_net: { ipv4: { ip: "1.2.3.4" } },
    }));
    waitForHcloudServerStatusMock.mockImplementation(async (params: any) => ({
      id: Number(params.id),
      name: "cattle-rex-1",
      status: "running",
      created: new Date("2026-01-01T00:00:00Z").toISOString(),
      labels: { "created-at": "1", "expires-at": "2", "managed-by": "clawdlets", cattle: "true", identity: "rex", "task-id": "t" },
      public_net: { ipv4: { ip: "1.2.3.4" } },
    }));

    await createCattleServer({
      token: "token",
      name: "cattle-rex-1",
      image: "img",
      serverType: "cx22",
      location: "nbg1",
      userData: "#cloud-config\n",
      labels: { "managed-by": "clawdlets", cattle: "true", identity: "rex", "task-id": "t", "created-at": "1", "expires-at": "2" },
    });

    await createCattleServer({
      token: "token",
      name: "cattle-rex-2",
      image: "img",
      serverType: "cx22",
      location: "nbg1",
      userData: "#cloud-config\n",
      labels: { "managed-by": "clawdlets", cattle: "true", identity: "rex", "task-id": "t", "created-at": "1", "expires-at": "2" },
    });

    expect(ensureHcloudFirewallIdMock).toHaveBeenCalledTimes(1);
  });
});
