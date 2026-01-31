import { describe, expect, it } from "vitest";

describe("release manifest", () => {
  it("parses a valid v1 manifest", async () => {
    const { ReleaseManifestV1Schema } = await import("../src/lib/release-manifest");

    const parsed = ReleaseManifestV1Schema.parse({
      schemaVersion: 1,
      host: "clawdbot-fleet-host",
      system: "x86_64-linux",
      channel: "staging",
      releaseId: 123,
      issuedAt: "2026-01-31T00:00:00Z",
      requiredFeatures: ["apply-manifest-v1"],
      rev: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toplevel: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-nixos-system-clawdbot-fleet-host-25.11",
      secrets: { digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      cache: {
        substituters: ["https://cache.nixos.org", "https://cache.garnix.io"],
        trustedPublicKeys: [
          "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
          "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
        ],
        narinfoCachePositiveTtl: 3600,
      },
    });

    expect(parsed.host).toBe("clawdbot-fleet-host");
    expect(parsed.releaseId).toBe(123);
    expect(parsed.cache?.substituters.length).toBe(2);
  });

  it("rejects invalid rev/toplevel/digest", async () => {
    const { ReleaseManifestV1Schema } = await import("../src/lib/release-manifest");

    expect(() =>
      ReleaseManifestV1Schema.parse({
        schemaVersion: 1,
        host: "clawdbot-fleet-host",
        system: "x86_64-linux",
        channel: "prod",
        releaseId: 1,
        issuedAt: "2026-01-31T00:00:00Z",
        rev: "nope",
        toplevel: " /nix/store/abc",
        secrets: { digest: "nope" },
      }),
    ).toThrow(/invalid rev/i);
  });

  it("requires secrets.format when secrets.url is set", async () => {
    const { ReleaseManifestV1Schema } = await import("../src/lib/release-manifest");

    expect(() =>
      ReleaseManifestV1Schema.parse({
        schemaVersion: 1,
        host: "clawdbot-fleet-host",
        system: "x86_64-linux",
        channel: "prod",
        releaseId: 1,
        issuedAt: "2026-01-31T00:00:00Z",
        rev: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toplevel: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-nixos-system-clawdbot-fleet-host-25.11",
        secrets: {
          digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          url: "https://example.com/secrets.tgz",
        },
      }),
    ).toThrow(/secrets\.format/i);
  });

  it("formats deterministically with trailing newline", async () => {
    const { formatReleaseManifest, parseReleaseManifestJson } = await import("../src/lib/release-manifest");

    const manifest = {
      schemaVersion: 1,
      host: "clawdbot-fleet-host",
      system: "x86_64-linux",
      channel: "staging",
      releaseId: 42,
      issuedAt: "2026-01-31T00:00:00Z",
      minUpdaterVersion: "0.4.3",
      rev: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toplevel: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-nixos-system-clawdbot-fleet-host-25.11",
      secrets: {
        digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        format: "sops-tar",
        url: "https://example.com/secrets.tgz",
      },
    } as const;

    const a = formatReleaseManifest(manifest);
    const b = formatReleaseManifest(parseReleaseManifestJson(a));

    expect(a.endsWith("\n")).toBe(true);
    expect(a).toBe(b);
  });
});

