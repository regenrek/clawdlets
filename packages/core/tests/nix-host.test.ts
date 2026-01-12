import { describe, it, expect } from "vitest";
import { upsertAdminAuthorizedKey } from "../src/lib/nix-host";

describe("nix-host", () => {
  it("upserts admin authorized key", () => {
    const otherKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEbbbbbbbbbbbbbbbbbbbbbbb other";
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test";
    const hostNix = `
users.users.admin = {
  openssh.authorizedKeys.keys = [
    "${otherKey}"
  ];
};
`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).not.toBeNull();
    expect(out).toContain(`"${key}"`);
  });

  it("inserts into an empty key list", () => {
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test";
    const hostNix = `
users.users.admin = {
  openssh.authorizedKeys.keys = [
  ];
};
`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).not.toBeNull();
    expect(out).toContain(`"${key}"`);
  });

  it("returns null when no key list found", () => {
    const out = upsertAdminAuthorizedKey({
      hostNix: "users.users.admin = {};",
      sshPubkey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa test",
    });
    expect(out).toBeNull();
  });

  it("returns null for invalid ssh pubkey", () => {
    const out = upsertAdminAuthorizedKey({
      hostNix: 'openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAA test" ];',
      sshPubkey: "nope",
    });
    expect(out).toBeNull();
  });

  it("does not change when key already present (normalized match)", () => {
    const base = "AAAAC3NzaC1lZDI1NTE5AAAAIEaaaaaaaaaaaaaaaaaaaaaaa";
    const hostNix = `
users.users.admin = {
  openssh.authorizedKeys.keys = [
    "ssh-ed25519 ${base} old-comment"
  ];
};
`;
    const key = `ssh-ed25519 ${base} new-comment`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).toBe(hostNix);
  });

});
