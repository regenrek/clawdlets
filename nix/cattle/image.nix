{ config, lib, pkgs, ... }:

{
  imports = [
    ../modules/clawdlets-host-meta.nix
    ../modules/clawdbot-cattle.nix
  ];

  formatConfigs.raw = { ... }: {
    boot.growPartition = lib.mkDefault true;
    fileSystems."/" = {
      device = lib.mkForce "/dev/disk/by-label/nixos";
      fsType = lib.mkDefault "ext4";
      autoResize = lib.mkDefault true;
    };
  };

  clawdlets.hostName = "clawdlets-cattle";
  clawdlets.diskDevice = "/dev/sda";

  fileSystems."/" = {
    device = lib.mkDefault "/dev/disk/by-label/nixos";
    fsType = lib.mkDefault "ext4";
    autoResize = lib.mkDefault true;
  };

  networking.hostName = lib.mkDefault config.clawdlets.hostName;
  networking.nameservers = config.clawdlets.nameservers;
  networking.useDHCP = false;
  networking.useNetworkd = true;
  systemd.network.networks."10-uplink" = {
    matchConfig.Name = "en*";
    networkConfig = {
      DHCP = "ipv4";
      IPv6AcceptRA = true;
    };
  };

  time.timeZone = "UTC";
  system.stateVersion = "25.11";

  users.mutableUsers = true;

  boot.loader.grub = {
    enable = true;
    devices = lib.mkDefault [ config.clawdlets.diskDevice ];
    efiSupport = false;
    useOSProber = false;
  };

  boot.initrd.availableKernelModules = [
    "virtio_pci"
    "virtio_scsi"
    "virtio_blk"
    "virtio_net"
  ];

  services.qemuGuest.enable = true;

  services.openssh = {
    enable = true;
    openFirewall = false;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
      AllowUsers = [ "admin" ];
    };
  };

  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ ];
    interfaces.tailscale0.allowedTCPPorts = [ 22 ];
  };

  services.tailscale = {
    enable = true;
    openFirewall = true;
    authKeyFile = "/run/secrets/tailscale_auth_key";
  };

  services.clawdbotCattle = {
    enable = true;
    autoShutdown = true;
  };

  environment.systemPackages = [
    pkgs.cacert
  ];
}
