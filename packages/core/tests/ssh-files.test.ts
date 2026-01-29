import { describe, expect, it } from "vitest";

import { parseKnownHostsFromText } from "../src/lib/ssh-files.js";

describe("parseKnownHostsFromText", () => {
  it("strips comments and blank lines", () => {
    const res = parseKnownHostsFromText(["# comment", "", "github.com ssh-ed25519 AAAA", "  "].join("\n"));
    expect(res).toEqual(["github.com ssh-ed25519 AAAA"]);
  });

  it("rejects empty input", () => {
    expect(() => parseKnownHostsFromText(["# only", "", "   "].join("\n"))).toThrow(/no known_hosts entries/i);
  });
});

