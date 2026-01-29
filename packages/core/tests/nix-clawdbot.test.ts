import { describe, expect, it } from "vitest";
import { parseNixClawdbotSource, fetchNixClawdbotSourceInfo } from "../src/lib/nix-clawdbot.js";

describe("parseNixClawdbotSource", () => {
  it("parses double-quoted attrs with comments", () => {
    const raw = `
      # pinned clawdbot
      {
        owner = "clawdbot";
        repo = "clawdbot";
        rev = "abc123";
        hash = "sha256-xyz";
        pnpmDepsHash = "sha256-abc";
      }
    `;
    const parsed = parseNixClawdbotSource(raw);
    expect(parsed).toEqual({ rev: "abc123", hash: "sha256-xyz", pnpmDepsHash: "sha256-abc" });
  });

  it("parses single-quoted attrs and strips block comments", () => {
    const raw = `
      /*
        comment with = and braces {}
      */
      {
        rev = 'deadbeef';
        hash = 'sha256-1';
        pnpmDepsHash = 'sha256-2';
      }
    `;
    const parsed = parseNixClawdbotSource(raw);
    expect(parsed).toEqual({ rev: "deadbeef", hash: "sha256-1", pnpmDepsHash: "sha256-2" });
  });

  it("returns null when rev is missing", () => {
    const raw = `{ hash = "sha256-x"; }`;
    const parsed = parseNixClawdbotSource(raw);
    expect(parsed).toBeNull();
  });
});

describe("fetchNixClawdbotSourceInfo", () => {
  it("rejects non-string refs without throwing", async () => {
    const res = await fetchNixClawdbotSourceInfo({ ref: undefined as unknown as string, timeoutMs: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid nix-clawdbot ref");
    }
  });

  it("rejects invalid refs", async () => {
    const res = await fetchNixClawdbotSourceInfo({ ref: "main\nbad", timeoutMs: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid nix-clawdbot ref");
      expect(res.sourceUrl).toBe("");
    }
  });

  it("parses fetched nix source", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          text: async () => `{
            rev = "abc123";
            hash = "sha256-x";
            pnpmDepsHash = "sha256-y";
          }`,
        }) as Response;
      const res = await fetchNixClawdbotSourceInfo({ ref: "main", timeoutMs: 1000 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.info.rev).toBe("abc123");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles non-200 responses", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        ({
          ok: false,
          status: 429,
          text: async () => "rate limited",
        }) as Response;
      const res = await fetchNixClawdbotSourceInfo({ ref: "main", timeoutMs: 1000 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("http 429");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
