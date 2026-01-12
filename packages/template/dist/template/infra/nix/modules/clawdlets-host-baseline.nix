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

  egress = cfg.egress;
  proxyEnabled = egress.mode == "proxy-allowlist";
  proxyPort = egress.proxy.port;
  proxyAddr4 = "127.0.0.1";
  proxyAddr6 = "::1";
  proxyUrl = "http://${proxyAddr4}:${toString proxyPort}";

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

    egress = {
      mode = lib.mkOption {
        type = lib.types.enum [ "smtp-only" "proxy-allowlist" "none" ];
        default = "smtp-only";
        description = ''
          Outbound network posture for bot services.

          - smtp-only: blocks outbound SMTP ports (anti-spam only).
          - proxy-allowlist: forces bot services to use a local HTTP proxy which enforces a destination domain allowlist.
          - none: no additional outbound controls.
        '';
      };

      proxy = {
        port = lib.mkOption {
          type = lib.types.int;
          default = 3128;
          description = "Local HTTP proxy port (loopback only).";
        };

        allowedDomains = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [];
          description = ''
            Destination domain allowlist for proxy-allowlist mode.

            Squid-style domain ACL entries (examples):
            - example.com
            - .example.com (matches subdomains)
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
    networking.nftables.ruleset =
      lib.mkIf (egress.mode == "smtp-only" || egress.mode == "proxy-allowlist") (builtins.readFile ../nftables/egress-block.nft);

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
      {
        assertion = (!proxyEnabled) || egress.proxy.allowedDomains != [];
        message = "clawdlets.egress.proxy.allowedDomains must be set when clawdlets.egress.mode is proxy-allowlist.";
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

    systemd.tmpfiles.rules = lib.mkIf proxyEnabled [
      "d /var/lib/clawdlets/proxy 0750 clawdlets-proxy clawdlets-proxy - -"
      "d /var/lib/clawdlets/proxy/cache 0750 clawdlets-proxy clawdlets-proxy - -"
      "d /var/lib/clawdlets/proxy/run 0750 clawdlets-proxy clawdlets-proxy - -"
    ];

    users.users.clawdlets-proxy = lib.mkIf proxyEnabled {
      isSystemUser = true;
      group = "clawdlets-proxy";
      home = "/var/lib/clawdlets/proxy";
      createHome = false;
      shell = pkgs.bashInteractive;
    };
    users.groups.clawdlets-proxy = lib.mkIf proxyEnabled { };

    environment.etc."clawdlets/proxy/squid.conf" = lib.mkIf proxyEnabled {
      mode = "0444";
      text =
        let
          allowed = lib.concatStringsSep " " egress.proxy.allowedDomains;
        in ''
          http_port ${proxyAddr4}:${toString proxyPort}
          http_port [${proxyAddr6}]:${toString proxyPort}

          pid_filename /var/lib/clawdlets/proxy/run/squid.pid

          # Minimal cache; keep squid happy but avoid pretending this is a CDN.
          cache_mem 0 MB
          maximum_object_size 0 KB
          cache_dir ufs /var/lib/clawdlets/proxy/cache 64 16 256

          # No privacy surprises: do not forward Proxy-Authorization etc (none expected).
          forwarded_for delete
          request_header_access Proxy-Authorization deny all
          request_header_access Proxy-Connection deny all

          # Only accept connections from localhost.
          acl localhost src 127.0.0.1/32 ::1

          # Safe ports / CONNECT.
          acl SSL_ports port 443
          acl Safe_ports port 80 443
          acl CONNECT method CONNECT

          # Domain allowlist (for HTTP Host and CONNECT host).
          acl allowed_sites dstdomain ${allowed}

          http_access deny !localhost
          http_access deny !Safe_ports
          http_access deny CONNECT !SSL_ports
          http_access deny localhost !allowed_sites
          http_access allow localhost allowed_sites
          http_access deny all

          # Logging: keep it simple; journald still has systemd logs.
          access_log stdio:/dev/stdout
          cache_log stdio:/dev/stderr
        '';
    };

    systemd.services.clawdlets-egress-proxy = lib.mkIf proxyEnabled {
      description = "Clawdlets egress proxy (domain allowlist)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        Type = "simple";
        User = "clawdlets-proxy";
        Group = "clawdlets-proxy";
        WorkingDirectory = "/var/lib/clawdlets/proxy";
        ExecStart = "${pkgs.squid}/bin/squid -N -f /etc/clawdlets/proxy/squid.conf";
        Restart = "always";
        RestartSec = "2";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ "/var/lib/clawdlets/proxy" ];
        UMask = "0077";

        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
        SystemCallArchitectures = "native";
      };
    };
  };
}
