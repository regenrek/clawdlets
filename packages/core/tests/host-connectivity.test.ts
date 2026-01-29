import { describe, it, expect } from "vitest";
import {
  extractFirstIpv4,
  isTailscaleIpv4,
  isValidIpv4,
  normalizeSingleLineOutput,
  parseBootstrapIpv4FromLogs,
} from "../src/lib/host-connectivity";

describe("host-connectivity", () => {
  it("validates ipv4", () => {
    expect(isValidIpv4("1.2.3.4")).toBe(true);
    expect(isValidIpv4("256.1.2.3")).toBe(false);
    expect(isValidIpv4("1.2.3")).toBe(false);
    expect(isValidIpv4("")).toBe(false);
  });

  it("extracts ipv4 from text", () => {
    expect(extractFirstIpv4("Target IPv4: 5.6.7.8")).toBe("5.6.7.8");
    expect(extractFirstIpv4("no ip here")).toBe(null);
  });

  it("parses bootstrap logs", () => {
    const lines = [
      "Bootstrap running...",
      "Target IPv4: 203.0.113.10",
    ];
    expect(parseBootstrapIpv4FromLogs(lines)).toBe("203.0.113.10");
  });

  it("normalizes single line output", () => {
    expect(normalizeSingleLineOutput("  hello\nworld\n")).toBe("hello");
  });

  it("detects tailscale ipv4", () => {
    expect(isTailscaleIpv4("100.64.0.1")).toBe(true);
    expect(isTailscaleIpv4("100.127.255.254")).toBe(true);
    expect(isTailscaleIpv4("100.63.0.1")).toBe(false);
    expect(isTailscaleIpv4("1.2.3.4")).toBe(false);
  });
});
