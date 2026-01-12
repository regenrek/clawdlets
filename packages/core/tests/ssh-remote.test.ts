import { describe, it, expect } from "vitest";
import { buildSshArgs, isValidTargetHost, validateTargetHost } from "../src/lib/ssh-remote";

describe("ssh target host validation", () => {
  it("accepts ssh aliases and user@host", () => {
    expect(validateTargetHost("botsmj")).toBe("botsmj");
    expect(validateTargetHost("root@botsmj")).toBe("root@botsmj");
  });

  it("rejects leading dash and whitespace/control chars", () => {
    expect(isValidTargetHost("-oProxyCommand=bad")).toBe(false);
    expect(isValidTargetHost("bad host")).toBe(false);
    expect(isValidTargetHost("bad\nname")).toBe(false);
    expect(() => validateTargetHost("-oProxyCommand=bad")).toThrow(/invalid target host/i);
  });
});

describe("ssh argv construction", () => {
  it("includes -- before destination", () => {
    expect(buildSshArgs("root@botsmj")).toEqual(["--", "root@botsmj"]);
  });

  it("keeps tty flag before --", () => {
    expect(buildSshArgs("botsmj", { tty: true })).toEqual(["-t", "--", "botsmj"]);
  });
});
