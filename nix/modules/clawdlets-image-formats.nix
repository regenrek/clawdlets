{ lib, ... }:
{
  config = {
    formatConfigs.raw = { ... }: {
      imports = [
        ./clawdlets-image-bootstrap.nix
      ];

      boot.growPartition = lib.mkDefault true;
      fileSystems."/" = {
        device = lib.mkForce "/dev/disk/by-label/nixos";
        autoResize = lib.mkDefault true;
      };
    };
  };
}
