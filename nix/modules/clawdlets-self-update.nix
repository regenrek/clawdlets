{ config, lib, pkgs, ... }:

let
  cfg = config.clawdlets;
in {
  options.clawdlets.selfUpdate = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable pull-based updates from a signed desired-state release manifest (pointer + immutable manifest).";
    };

    baseUrl = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Base URL for this host+channel (must contain latest.json and <releaseId>.json).";
    };

    interval = lib.mkOption {
      type = lib.types.str;
      default = "30min";
      description = "systemd OnCalendar value for self-update checks.";
    };

    channel = lib.mkOption {
      type = lib.types.str;
      default = "prod";
      description = "Release channel this host follows (staging|prod|...).";
    };

    publicKeys = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Trusted minisign public keys (newline-delimited).";
    };

    allowUnsigned = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Dev-only: allow unsigned pointers/manifests (NOT recommended).";
    };

    allowRollback = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Break-glass: allow applying a manifest with lower releaseId (replay protection bypass).";
    };

    healthCheckUnit = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional systemd unit to require active after switch (record-only).";
    };
  };

  config = {
    assertions = [
      {
        assertion = (!cfg.selfUpdate.enable) || (cfg.selfUpdate.baseUrl != "");
        message = "clawdlets.selfUpdate.baseUrl must be set when self-update is enabled.";
      }
    ];

    environment.etc."clawdlets/bin/update-fetch" = {
      source = ../scripts/update-fetch.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/bin/update-apply" = {
      source = ../scripts/update-apply.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/bin/update-status" = {
      source = ../scripts/update-status.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/bin/update-ingest" = {
      source = ../scripts/update-ingest.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/updater/manifest.keys" = lib.mkIf cfg.selfUpdate.enable {
      mode = "0444";
      text = lib.concatStringsSep "\n" cfg.selfUpdate.publicKeys + "\n";
    };

    systemd.services.clawdlets-update-fetch = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawdlets update: fetch desired state (pointer + manifest)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = [ pkgs.bash pkgs.curl pkgs.jq pkgs.coreutils pkgs.minisign pkgs.util-linux ];
      environment = {
        CLAWDLETS_UPDATER_BASE_URL = cfg.selfUpdate.baseUrl;
        CLAWDLETS_UPDATER_STATE_DIR = "/var/lib/clawdlets/updates";
        CLAWDLETS_UPDATER_KEYS_FILE = "/etc/clawdlets/updater/manifest.keys";
        CLAWDLETS_UPDATER_ALLOW_UNSIGNED = if cfg.selfUpdate.allowUnsigned then "true" else "false";
      };
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        UMask = "0077";
        StateDirectory = "clawdlets/updates";
        StateDirectoryMode = "0700";
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        NoNewPrivileges = true;
        ReadWritePaths = [ "/nix" "/var" ];
      };
      script = ''
        set -euo pipefail

        /etc/clawdlets/bin/update-fetch
        /run/current-system/sw/bin/systemctl start clawdlets-update-apply.service
      '';
    };

    systemd.services.clawdlets-update-apply = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawdlets update: apply desired state";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = [ pkgs.bash pkgs.curl pkgs.jq pkgs.coreutils pkgs.minisign pkgs.util-linux pkgs.nix ];
      environment = {
        CLAWDLETS_UPDATER_BASE_URL = cfg.selfUpdate.baseUrl;
        CLAWDLETS_UPDATER_STATE_DIR = "/var/lib/clawdlets/updates";
        CLAWDLETS_UPDATER_KEYS_FILE = "/etc/clawdlets/updater/manifest.keys";
        CLAWDLETS_UPDATER_HOST_NAME = config.networking.hostName;
        CLAWDLETS_UPDATER_CHANNEL = cfg.selfUpdate.channel;
        CLAWDLETS_UPDATER_SECRETS_DIR = config.clawdlets.secrets.hostDir;
        CLAWDLETS_UPDATER_ALLOW_UNSIGNED = if cfg.selfUpdate.allowUnsigned then "true" else "false";
        CLAWDLETS_UPDATER_ALLOW_ROLLBACK = if cfg.selfUpdate.allowRollback then "true" else "false";
        CLAWDLETS_UPDATER_HEALTHCHECK_UNIT = if cfg.selfUpdate.healthCheckUnit != null then cfg.selfUpdate.healthCheckUnit else "";
        CLAWDLETS_UPDATER_ALLOWED_SUBSTITUTERS = lib.concatStringsSep " " (config.nix.settings.substituters or []);
        CLAWDLETS_UPDATER_ALLOWED_TRUSTED_PUBLIC_KEYS = lib.concatStringsSep " " (config.nix.settings."trusted-public-keys" or []);
      };
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        UMask = "0077";
        StateDirectory = "clawdlets/updates";
        StateDirectoryMode = "0700";
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        NoNewPrivileges = true;
        ReadWritePaths = [ "/nix" "/var" ];
      };
      script = ''
        set -euo pipefail
        /etc/clawdlets/bin/update-apply
      '';
    };

    systemd.timers.clawdlets-update-fetch = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawdlets update: fetch+apply timer";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = cfg.selfUpdate.interval;
        Persistent = true;
        RandomizedDelaySec = "2m";
        Unit = "clawdlets-update-fetch.service";
      };
    };
  };
}
