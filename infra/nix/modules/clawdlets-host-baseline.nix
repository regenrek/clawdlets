{ config, lib, pkgs, flakeInfo ? {}, ... }:

let
  cfg = config.clawdlets;

  defaultHostSecretsDir = "/var/lib/clawdlets/secrets/hosts/${config.networking.hostName}";
  hostSecretsDir =
    if (cfg.secrets.hostDir or null) != null
    then cfg.secrets.hostDir
    else defaultHostSecretsDir;

  provisioningEnabled = cfg.provisioning.enable;
  publicSshEnabled = cfg.publicSsh.enable;

  isTailscale = cfg.tailnet.mode == "tailscale";
  tailscaleCfg = cfg.tailnet.tailscale;

  sshListen = [
    # NixOS' OpenSSH module formats `ListenAddress` as `${addr}:${port}` when `port` is set.
    # For IPv6 this becomes `:::22` and sshd rejects it. Keep `port = null` and rely on `services.openssh.ports` (default: 22).
    { addr = "0.0.0.0"; port = null; }
    { addr = "::"; port = null; }
  ];

  sopsSecrets = import ../lib/sops-secrets.nix { };
  mkSopsSecret = secretName: (sopsSecrets.mkSopsSecretFor { hostDir = hostSecretsDir; }) secretName;
in
{
  options.clawdlets = {
    provisioning = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Bootstrap/provisioning mode (relaxes validation).";
      };
    };

    publicSsh = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Allow SSH on port 22 from the public internet (prefer tailnet).";
      };
    };

    secrets = {
      hostDir = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = ''
          Directory containing encrypted sops YAML files on the host filesystem (one secret per file).

          Recommended (keeps secrets out of the Nix store):
          - /var/lib/clawdlets/secrets/hosts/<host>/
        '';
      };

      ageKeyFile = lib.mkOption {
        type = lib.types.str;
        default = "/var/lib/sops-nix/key.txt";
        description = "Path to the age key on the host (sops-nix).";
      };
    };

    tailnet = {
      mode = lib.mkOption {
        type = lib.types.enum [ "none" "tailscale" ];
        default = "none";
        description = "Admin access mode for this host.";
      };

      tailscale = {
        openFirewall = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Allow Tailscale UDP/DERP ports via firewall (services.tailscale.openFirewall).";
        };

        ssh = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Enable Tailscale SSH (tailscale up --ssh).";
        };

        authKeySecret = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Sops secret name containing a Tailscale auth key for non-interactive login.";
        };
      };
    };

    operator = {
      rebuild = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Allow admin to trigger a constrained pinned rebuild via sudo (see clawdlets-host.nix).";
        };

        flakeBase = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = ''
            Flake base used by /etc/clawdlets/bin/rebuild-host (must be github:owner/repo).

            NOTE: this is intended for public repos; private repo rebuilds should be done from a trusted workstation
            that can inject GitHub access tokens.
          '';
        };
      };
    };
  };

  config = {
    clawdlets.secrets.hostDir = lib.mkDefault defaultHostSecretsDir;

    system.configurationRevision = lib.mkDefault (flakeInfo.clawdlets.rev or null);

    swapDevices = lib.mkDefault [
      {
        device = "/var/lib/swapfile";
        size = 16384;
      }
    ];

    nix.settings = {
      max-jobs = lib.mkDefault 1;
      cores = lib.mkDefault 2;

      extra-substituters = lib.mkDefault [ "https://cache.garnix.io" ];
      extra-trusted-public-keys = lib.mkDefault [
        "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g="
      ];
    };

    boot.loader.grub = {
      enable = true;
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
      listenAddresses = sshListen;
    };

    security.sudo.wheelNeedsPassword = true;

    networking.firewall = {
      enable = true;
      allowedTCPPorts = lib.mkIf publicSshEnabled [ 22 ];
      interfaces.tailscale0.allowedTCPPorts = lib.mkIf (isTailscale && !publicSshEnabled) [ 22 ];
    };

    networking.nftables.enable = true;
    networking.nftables.ruleset = builtins.readFile ../nftables/egress-block.nft;

    sops = {
      age.keyFile = cfg.secrets.ageKeyFile;
      validateSopsFiles = false;

      secrets = lib.optionalAttrs (isTailscale && tailscaleCfg.authKeySecret != null && tailscaleCfg.authKeySecret != "") {
        "${tailscaleCfg.authKeySecret}" = mkSopsSecret tailscaleCfg.authKeySecret;
      };
    };

    services.tailscale = lib.mkIf isTailscale {
      enable = true;
      openFirewall = tailscaleCfg.openFirewall;
      authKeyFile = lib.mkIf (tailscaleCfg.authKeySecret != null)
        config.sops.secrets.${tailscaleCfg.authKeySecret}.path;
      extraUpFlags = lib.optional tailscaleCfg.ssh "--ssh";
    };
    assertions = [
      {
        assertion =
          (!isTailscale)
          || provisioningEnabled
          || publicSshEnabled
          || (tailscaleCfg.authKeySecret != null && tailscaleCfg.authKeySecret != "");
        message = "clawdlets.tailnet.tailscale.authKeySecret must be set when tailnet mode is tailscale (or enable clawdlets.provisioning.enable / clawdlets.publicSsh.enable for first boot).";
      }
      {
        assertion =
          (!cfg.operator.rebuild.enable)
          || ((cfg.operator.rebuild.flakeBase or null) != null && (cfg.operator.rebuild.flakeBase or "") != "");
        message = "clawdlets.operator.rebuild.flakeBase must be set when clawdlets.operator.rebuild.enable is true.";
      }
    ];

    environment.etc."clawdlets/bin/rebuild-host" = {
      source = ../../../scripts/rebuild-host.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/rebuild.env" = lib.mkIf cfg.operator.rebuild.enable {
      mode = "0444";
      text = ''
        CLAWDLETS_REBUILD_FLAKE_BASE=${cfg.operator.rebuild.flakeBase}
        CLAWDLETS_REBUILD_HOST=${config.clawdlets.hostName}
      '';
    };
  };
}
