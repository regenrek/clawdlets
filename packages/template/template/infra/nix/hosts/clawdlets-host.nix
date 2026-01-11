{ config, lib, ... }:

let
  cfg = builtins.fromJSON (builtins.readFile ../../configs/clawdlets.json);
  hostCfg = (cfg.hosts.${config.clawdlets.hostName} or { });
  tailnet = (hostCfg.tailnet or { });
  tailnetMode = tailnet.mode or "none";
  fleet = import ../../configs/fleet.nix { inherit lib; };
  enableRootPassword = false;
in {
  imports = [
    ../modules/clawdlets-host-baseline.nix
    ../modules/clawdbot-fleet.nix
    ../modules/clawdlets-host-meta.nix
  ];

  clawdlets.diskDevice = hostCfg.diskDevice or "/dev/disk/by-id/CHANGE_ME";

  clawdlets.publicSsh.enable = ((hostCfg.publicSsh or { }).enable or false);
  clawdlets.provisioning.enable = ((hostCfg.provisioning or { }).enable or false);

  clawdlets.tailnet.mode = tailnetMode;
  clawdlets.tailnet.tailscale.authKeySecret =
    if tailnetMode == "tailscale" then "tailscale_auth_key" else null;

  # Set these in your own repo (or via a host-specific module).
  # Defaults are provided for Hetzner, but hostName must be set.
  networking.hostName = config.clawdlets.hostName;
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

  users.mutableUsers = false;

  sops.secrets.admin_password_hash = {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
    sopsFile = "${config.clawdlets.secrets.hostDir}/admin_password_hash.yaml";
  };

  sops.secrets.root_password_hash = lib.mkIf enableRootPassword {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
    sopsFile = "${config.clawdlets.secrets.hostDir}/root_password_hash.yaml";
  };

  users.users.admin = {
    isNormalUser = true;
    extraGroups = [ ];
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
    openssh.authorizedKeys.keys = hostCfg.sshAuthorizedKeys or [ ];
  };

  # Breakglass: console-only sudo/root access.
  # SSH password auth is disabled, so this user is not reachable over SSH unless you explicitly change SSH settings.
  users.users.breakglass = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
  };

  users.users.root.hashedPasswordFile =
    lib.mkIf enableRootPassword config.sops.secrets.root_password_hash.path;

  security.sudo.extraConfig = ''
    Cmnd_Alias CLAWDBOT_SYSTEMCTL = \
      /run/current-system/sw/bin/systemctl status clawdbot-*, \
      /run/current-system/sw/bin/systemctl status clawdbot-* --no-pager, \
      /run/current-system/sw/bin/systemctl status clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl status clawdbot-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl start clawdbot-*, \
      /run/current-system/sw/bin/systemctl start clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl stop clawdbot-*, \
      /run/current-system/sw/bin/systemctl stop clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl restart clawdbot-*, \
      /run/current-system/sw/bin/systemctl restart clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl list-timers clawdbot-*, \
      /run/current-system/sw/bin/systemctl list-timers clawdbot-* --all, \
      /run/current-system/sw/bin/systemctl list-timers clawdbot-* --all --no-pager, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-* --no-pager, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl show clawdbot-*, \
      /run/current-system/sw/bin/systemctl show clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*.service
    Cmnd_Alias CLAWDBOT_JOURNAL = \
      /run/current-system/sw/bin/journalctl -u clawdbot-* --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --no-pager
    Cmnd_Alias CLAWDBOT_SS = /run/current-system/sw/bin/ss -ltnp
    Cmnd_Alias CLAWDBOT_GH_SYNC_READ = /etc/clawdlets/bin/gh-sync-read *
    Cmnd_Alias CLAWDBOT_REBUILD = \
      /run/current-system/sw/bin/nixos-rebuild, \
      /run/current-system/sw/bin/env /run/current-system/sw/bin/nixos-rebuild switch --flake *, \
      /run/current-system/sw/bin/env NIX_CONFIG=access-tokens\ =\ github.com=* /run/current-system/sw/bin/nixos-rebuild switch --flake *, \
      /run/current-system/sw/bin/env nixos-rebuild switch --flake *, \
      /run/current-system/sw/bin/env NIX_CONFIG=access-tokens\ =\ github.com=* nixos-rebuild switch --flake *
    admin ALL=(root) NOPASSWD: CLAWDBOT_SYSTEMCTL, CLAWDBOT_JOURNAL, CLAWDBOT_SS, CLAWDBOT_GH_SYNC_READ, CLAWDBOT_REBUILD
  '';

  services.clawdbotFleet = {
    enable = hostCfg.enable or false;
    sopsDir = config.clawdlets.secrets.hostDir;
    bots = fleet.bots;
    guildId = fleet.guildId;
    routing = fleet.routing;
    botProfiles = fleet.botProfiles;
    backups = fleet.backups;
    documentsDir = fleet.documentsDir;
    identity = fleet.identity;
    codex = fleet.codex;
    opsSnapshot.enable = true;
    disableBonjour = true;
    agentModelPrimary = hostCfg.agentModelPrimary or "zai/glm-4.7";
  };
}
