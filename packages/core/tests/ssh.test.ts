import { describe, it, expect } from "vitest";

import {
  looksLikeSshKeyContents,
  looksLikeSshPrivateKey,
  normalizeSshPublicKey,
  parseSshPublicKeyLine,
  parseSshPublicKeysFromText,
} from "../src/lib/ssh";

describe("ssh public key parsing", () => {
  it("normalizes common key types", () => {
    expect(normalizeSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test")).toBe(
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(
      normalizeSshPublicKey("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= comment"),
    ).toBe("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=");
  });

  it("detects key contents vs paths", () => {
    expect(looksLikeSshKeyContents("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test")).toBe(
      true,
    );
    expect(looksLikeSshKeyContents("/tmp/id_ed25519.pub")).toBe(false);
  });

  it("parses authorized_keys style options", () => {
    const parsed = parseSshPublicKeyLine(
      'from="*.example.com",no-pty ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa user@host',
    );
    expect(parsed).toEqual({
      type: "ssh-ed25519",
      base64: "AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("extracts multiple keys from text", () => {
    const keys = parseSshPublicKeysFromText([
      "# comment",
      "",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa one",
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= two",
      "",
    ].join("\n"));
    expect(keys).toEqual([
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa",
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=",
    ]);
  });
});

describe("ssh private key detection", () => {
  it("recognizes private key PEM headers", () => {
    expect(looksLikeSshPrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n")).toBe(true);
    expect(looksLikeSshPrivateKey("-----BEGIN PRIVATE KEY-----\nabc\n")).toBe(true);
    expect(looksLikeSshPrivateKey("ssh-ed25519 AAAA test")).toBe(false);
  });
});

