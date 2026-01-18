{ config, lib, project, ... }:

let
  cfg = project.config;
  hostCfg = (cfg.hosts.${config.clawdlets.hostName} or { });
  tailnet = (hostCfg.tailnet or { });
  tailnetMode = tailnet.mode or "none";
  sshExposureMode = ((hostCfg.sshExposure or { }).mode or "tailnet");
  cacheCfg = (hostCfg.cache or { });
  garnixCache = (cacheCfg.garnix or { });
  garnixPrivate = (garnixCache.private or { });
  selfUpdate = (hostCfg.selfUpdate or { });
  allowMissingSecrets = config.clawdlets.bootstrap.allowMissingSecrets;
  fleet = import ../lib/fleet-config.nix { inherit lib project; };
  enableRootPassword = false;
in {
  imports = [
    ../disko/hetzner-ext4.nix
    ../modules/clawdlets-image-formats.nix
    ../modules/clawdlets-host-baseline.nix
    ../modules/clawdlets-self-update.nix
    ../modules/clawdbot-fleet.nix
    ../modules/clf-orchestrator.nix
    ../modules/clawdlets-host-meta.nix
  ];

  clawdlets.diskDevice = hostCfg.diskDevice or "/dev/sda";

  clawdlets.sshExposure.mode = sshExposureMode;

  clawdlets.tailnet.mode = tailnetMode;
  clawdlets.tailnet.tailscale.authKeySecret =
    if tailnetMode == "tailscale" then "tailscale_auth_key" else null;
  clawdlets.operator.deploy.enable =
    ((hostCfg.operator or { }).deploy or { }).enable or false;
  clawdlets.cache.garnix.private.enable = (garnixPrivate.enable or false);
  clawdlets.cache.garnix.private.netrcSecret = (garnixPrivate.netrcSecret or "garnix_netrc");
  clawdlets.cache.garnix.private.netrcPath = (garnixPrivate.netrcPath or "/etc/nix/netrc");
  clawdlets.cache.garnix.private.narinfoCachePositiveTtl = (garnixPrivate.narinfoCachePositiveTtl or 3600);

  clawdlets.selfUpdate.enable = (selfUpdate.enable or false);
  clawdlets.selfUpdate.manifestUrl = (selfUpdate.manifestUrl or "");
  clawdlets.selfUpdate.interval = (selfUpdate.interval or "30min");
  clawdlets.selfUpdate.publicKey =
    let v = (selfUpdate.publicKey or ""); in if v != "" then v else null;
  clawdlets.selfUpdate.signatureUrl =
    let v = (selfUpdate.signatureUrl or ""); in if v != "" then v else null;

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

  sops.secrets.admin_password_hash = lib.mkIf (!allowMissingSecrets) {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
    sopsFile = "${config.clawdlets.secrets.hostDir}/admin_password_hash.yaml";
  };

  sops.secrets.root_password_hash = lib.mkIf (!allowMissingSecrets && enableRootPassword) {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
    sopsFile = "${config.clawdlets.secrets.hostDir}/root_password_hash.yaml";
  };

  users.users.admin = {
    isNormalUser = true;
    extraGroups = [ ];
    openssh.authorizedKeys.keys = hostCfg.sshAuthorizedKeys or [ ];
  }
  // lib.optionalAttrs (!allowMissingSecrets) {
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
  }
  // lib.optionalAttrs allowMissingSecrets {
    hashedPassword = "!";
  };

  # Breakglass: console-only sudo/root access.
  # SSH password auth is disabled, so this user is not reachable over SSH unless you explicitly change SSH settings.
  users.users.breakglass = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
  }
  // lib.optionalAttrs (!allowMissingSecrets) {
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
  }
  // lib.optionalAttrs allowMissingSecrets {
    hashedPassword = "!";
  };

  users.users.root.hashedPasswordFile =
    lib.mkIf (!allowMissingSecrets && enableRootPassword) config.sops.secrets.root_password_hash.path;

  security.sudo.extraConfig =
    let
      deploySudo =
        lib.optionalString config.clawdlets.operator.deploy.enable ''
          Cmnd_Alias CLAWDLETS_DEPLOY = \
            /etc/clawdlets/bin/install-secrets --host * --tar * --rev *, \
            /etc/clawdlets/bin/install-secrets --host * --tar * --rev * --digest *, \
            /etc/clawdlets/bin/switch-system --toplevel * --rev *, \
            /etc/clawdlets/bin/switch-system --toplevel * --rev * --dry-run
        '';
      deployAlias =
        if config.clawdlets.operator.deploy.enable
        then ", CLAWDLETS_DEPLOY"
        else "";
    in ''
    Cmnd_Alias CLAWDBOT_SYSTEMCTL = \
      /run/current-system/sw/bin/systemctl is-active tailscaled.service, \
      /run/current-system/sw/bin/systemctl is-active tailscaled-autoconnect.service, \
      /run/current-system/sw/bin/systemctl show tailscaled.service, \
      /run/current-system/sw/bin/systemctl show tailscaled-autoconnect.service, \
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
      /run/current-system/sw/bin/systemctl list-units --all --plain --legend=false --no-pager clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl show clawdbot-*, \
      /run/current-system/sw/bin/systemctl show clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*.service
    Cmnd_Alias CLAWDBOT_JOURNAL = \
      /run/current-system/sw/bin/journalctl -u clawdbot-* --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * -f --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --since * --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --since * -f --no-pager
    Cmnd_Alias CLAWDBOT_SS = /run/current-system/sw/bin/ss -ltnp
    Cmnd_Alias CLAWDBOT_GH_SYNC_READ = /etc/clawdlets/bin/gh-sync-read *
    ${deploySudo}
    admin ALL=(root) NOPASSWD: CLAWDBOT_SYSTEMCTL, CLAWDBOT_JOURNAL, CLAWDBOT_SS, CLAWDBOT_GH_SYNC_READ${deployAlias}
  '';

  services.clawdbotFleet = {
    enable = hostCfg.enable or false;
    bots = fleet.bots;
    botProfiles = fleet.botProfiles;
    backups = fleet.backups;
    documentsDir = fleet.documentsDir;
    codex = fleet.codex;
    opsSnapshot.enable = true;
    disableBonjour = true;
    agentModelPrimary = hostCfg.agentModelPrimary or "zai/glm-4.7";
  };
}
