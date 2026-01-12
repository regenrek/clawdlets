{ pkgs, ... }:
{
  packages = [
    pkgs.age
    pkgs.curl
    pkgs.git
    pkgs.gh
    pkgs.jq
    pkgs.just
    pkgs.nodejs_22
    pkgs.nixos-anywhere
    pkgs.openssh
    pkgs.pnpm_10
    pkgs.ripgrep
    pkgs.sops
    pkgs.opentofu
  ];
}
