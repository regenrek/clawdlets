import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { formatDeployManifest, parseDeployManifest, requireRev, requireToplevel } from "../src/lib/deploy-manifest.js";

describe("deploy manifest helpers", () => {
  it("validates rev and toplevel", () => {
    expect(() => requireRev("bad")).toThrow(/invalid rev/);
    expect(() => requireToplevel("")).toThrow(/missing toplevel/);
    expect(requireRev("a".repeat(40))).toBe("a".repeat(40));
    expect(requireToplevel("/nix/store/abcd1234")).toBe("/nix/store/abcd1234");
  });

  it("parses manifest JSON", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-manifest-"));
    const file = path.join(dir, "deploy.json");
    const manifest = {
      rev: "b".repeat(40),
      host: "alpha",
      toplevel: "/nix/store/abcd1234",
      secretsDigest: "c".repeat(64),
    };
    fs.writeFileSync(file, formatDeployManifest(manifest), "utf8");
    const parsed = parseDeployManifest(file);
    expect(parsed).toEqual(manifest);
  });
});
