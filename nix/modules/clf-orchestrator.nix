{ config, lib, pkgs, clawdlets, project, ... }:

let
  system = pkgs.system;
  clawdletsPkgs =
    clawdlets.packages.${system} or
      (throw "clawdlets.packages.${system} missing (must consume clawdlets flake outputs)");

  fleetCfg = project.config;
  cattleCfg = fleetCfg.cattle or { };
  cattleHetzner = cattleCfg.hetzner or { };
  cattleDefaults = cattleCfg.defaults or { };

  envSecrets = fleetCfg.fleet.envSecrets or { };
  envSecretsKeys = builtins.attrNames envSecrets;
  envSecretsSecretNames =
    builtins.filter (s: s != null && s != "") (builtins.attrValues envSecrets);

  tailscaleSecret = config.clawdlets.tailnet.tailscale.authKeySecret or null;

  identitiesDir = project.root + "/identities";
  identitiesExists = builtins.pathExists identitiesDir;
  identityNames =
    if !identitiesExists
    then [ ]
    else
      builtins.filter (n:
        let t = (builtins.readDir identitiesDir).${n} or null;
        in t == "directory"
      ) (builtins.attrNames (builtins.readDir identitiesDir));

  mkIdentityEtc = name:
    let
      base = "clf/identities/${name}";
      soul = "${identitiesDir}/${name}/SOUL.md";
      cfg = "${identitiesDir}/${name}/config.json";
    in
      lib.optionalAttrs (builtins.pathExists soul) {
        "${base}/SOUL.md" = { source = soul; mode = "0444"; };
      }
      // lib.optionalAttrs (builtins.pathExists cfg) {
        "${base}/config.json" = { source = cfg; mode = "0444"; };
      };

  mkEnvLine = envVar:
    let secretName = envSecrets.${envVar} or "";
    in lib.optionalString (secretName != "") "${envVar}=${config.sops.placeholder.${secretName}}";

  cfg = config.services.clfOrchestrator;
in
{
  options.services.clfOrchestrator = {
    enable = lib.mkEnableOption "ClawdletFleet orchestrator (jobs queue + cattle spawner)";

    package = lib.mkOption {
      type = lib.types.package;
      default = clawdletsPkgs.clf;
      description = "Package providing `clf` and `clf-orchestrator`.";
    };

    hcloudTokenSecret = lib.mkOption {
      type = lib.types.str;
      default = "hcloud_token";
      description = "SOPS secret name for Hetzner API token (value exported as HCLOUD_TOKEN).";
    };

    dbPath = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/clf/orchestrator/state.sqlite";
      description = "SQLite DB path for orchestrator queue/state.";
    };

    socketPath = lib.mkOption {
      type = lib.types.str;
      default = "/run/clf/orchestrator.sock";
      description = "Unix socket path for orchestrator HTTP API.";
    };

    workerConcurrency = lib.mkOption {
      type = lib.types.int;
      default = 2;
      description = "Number of worker loops.";
    };

    cattle = {
      image = lib.mkOption {
        type = lib.types.str;
        default = cattleHetzner.image or "";
        description = "Hetzner image id/name for cattle VMs (required).";
      };
      serverType = lib.mkOption {
        type = lib.types.str;
        default = cattleHetzner.serverType or "cx22";
        description = "Hetzner server type.";
      };
      location = lib.mkOption {
        type = lib.types.str;
        default = cattleHetzner.location or "nbg1";
        description = "Hetzner location.";
      };
      maxInstances = lib.mkOption {
        type = lib.types.int;
        default = cattleHetzner.maxInstances or 10;
        description = "Hard limit for concurrently running cattle servers.";
      };
      defaultTtl = lib.mkOption {
        type = lib.types.str;
        default = cattleHetzner.defaultTtl or "2h";
        description = "Default TTL for cattle.spawn jobs.";
      };
      labels = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = cattleHetzner.labels or { };
        description = "Extra base labels applied to cattle servers.";
      };
      autoShutdown = lib.mkOption {
        type = lib.types.bool;
        default = cattleDefaults.autoShutdown or true;
        description = "Default autoShutdown for cattle.spawn jobs.";
      };
      secretsListenHost = lib.mkOption {
        type = lib.types.str;
        default = "auto";
        description = "Internal cattle secrets HTTP bind host (default: auto resolves tailscale0 IPv4).";
      };
      secretsListenPort = lib.mkOption {
        type = lib.types.int;
        default = 18337;
        description = "Internal cattle secrets HTTP port (tailnet-only).";
      };
      secretsBaseUrl = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = "Base URL cattle uses to fetch secrets env (default: computed from listen host + port).";
      };
      bootstrapTtlMs = lib.mkOption {
        type = lib.types.int;
        default = 5 * 60 * 1000;
        description = "One-time bootstrap token TTL (ms).";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.cattle.image != "";
        message = "services.clfOrchestrator.cattle.image must be set (or set cattle.hetzner.image in fleet/clawdlets.json).";
      }
      {
        assertion = tailscaleSecret != null && tailscaleSecret != "";
        message = "clawdlets.tailnet.tailscale.authKeySecret must be set (needed to spawn cattle with tailscale).";
      }
    ];

    networking.firewall.interfaces.tailscale0.allowedTCPPorts = lib.mkAfter [ cfg.cattle.secretsListenPort ];

    users.groups.clf-bots = { };
    users.groups.clf-orchestrator = { };
    users.users = lib.mkMerge [
      {
        clf-orchestrator = {
          isSystemUser = true;
          group = "clf-orchestrator";
          home = "/var/lib/clf/orchestrator";
          createHome = false;
          shell = pkgs.bashInteractive;
        };
      }
      (builtins.listToAttrs (map (b: {
        name = "bot-${b}";
        value = { extraGroups = lib.mkAfter [ "clf-bots" ]; };
      }) (config.services.clawdbotFleet.bots or [ ])))
    ];

    environment.systemPackages = [ cfg.package ];

    environment.etc = lib.mkMerge (
      [
        {
          "clf/admin_authorized_keys" = {
            mode = "0444";
            text = lib.concatStringsSep "\n" ((config.users.users.admin.openssh.authorizedKeys.keys or [ ]) ++ [ "" ]);
          };
        }
      ]
      ++ (map mkIdentityEtc identityNames)
    );

    systemd.tmpfiles.rules = [
      "d /run/clf 0755 root root - -"
      "d /var/lib/clf 0755 clf-orchestrator clf-orchestrator - -"
      "d /var/lib/clf/orchestrator 0750 clf-orchestrator clf-orchestrator - -"
    ];

    sops.secrets = lib.mkMerge [
      (lib.optionalAttrs (cfg.hcloudTokenSecret != "") {
        "${cfg.hcloudTokenSecret}" = {
          owner = "root";
          group = "root";
          mode = "0400";
          sopsFile = "${config.clawdlets.secrets.hostDir}/${cfg.hcloudTokenSecret}.yaml";
        };
      })
      (builtins.listToAttrs (map (secretName: {
        name = secretName;
        value = {
          owner = "root";
          group = "root";
          mode = "0400";
          sopsFile = "${config.clawdlets.secrets.hostDir}/${secretName}.yaml";
        };
      }) envSecretsSecretNames))
    ];

    sops.templates."clf-orchestrator.env" = {
      owner = "clf-orchestrator";
      group = "clf-orchestrator";
      mode = "0400";
      content =
        lib.concatStringsSep "\n" (
          [
            "HCLOUD_TOKEN=${config.sops.placeholder.${cfg.hcloudTokenSecret}}"
            "TAILSCALE_AUTH_KEY=${config.sops.placeholder.${tailscaleSecret}}"
          ]
          ++ (map mkEnvLine envSecretsKeys)
          ++ [ "" ]
        );
    };

    systemd.sockets.clf-orchestrator = {
      wantedBy = [ "sockets.target" ];
      socketConfig = {
        ListenStream = cfg.socketPath;
        SocketUser = "root";
        SocketGroup = "clf-bots";
        SocketMode = "0660";
        RemoveOnStop = true;
      };
    };

    systemd.services.clf-orchestrator = {
      description = "ClawdletFleet orchestrator (jobs + cattle)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "sops-nix.service" "tailscaled.service" ];
      wants = [ "network-online.target" "sops-nix.service" "tailscaled.service" ];
      requires = [ "clf-orchestrator.socket" ];

      environment = {
        CLF_DB_PATH = cfg.dbPath;
        CLF_SOCKET_PATH = cfg.socketPath;
        CLF_WORKER_CONCURRENCY = toString cfg.workerConcurrency;

        CLF_CATTLE_IMAGE = cfg.cattle.image;
        CLF_CATTLE_SERVER_TYPE = cfg.cattle.serverType;
        CLF_CATTLE_LOCATION = cfg.cattle.location;
        CLF_CATTLE_MAX_INSTANCES = toString cfg.cattle.maxInstances;
        CLF_CATTLE_DEFAULT_TTL = cfg.cattle.defaultTtl;
        CLF_CATTLE_LABELS_JSON = builtins.toJSON cfg.cattle.labels;
        CLF_CATTLE_AUTO_SHUTDOWN = if cfg.cattle.autoShutdown then "1" else "0";

        CLF_CATTLE_SECRETS_LISTEN_HOST = cfg.cattle.secretsListenHost;
        CLF_CATTLE_SECRETS_LISTEN_PORT = toString cfg.cattle.secretsListenPort;
        CLF_CATTLE_SECRETS_BASE_URL = cfg.cattle.secretsBaseUrl;
        CLF_CATTLE_BOOTSTRAP_TTL_MS = toString cfg.cattle.bootstrapTtlMs;

        CLF_IDENTITIES_ROOT = "/etc/clf/identities";
        CLF_ADMIN_AUTHORIZED_KEYS_FILE = "/etc/clf/admin_authorized_keys";
      };

      serviceConfig = {
        Type = "simple";
        User = "clf-orchestrator";
        Group = "clf-orchestrator";
        WorkingDirectory = "/var/lib/clf/orchestrator";
        ExecStart = "${cfg.package}/bin/clf-orchestrator";
        EnvironmentFile = [ config.sops.templates."clf-orchestrator.env".path ];
        Sockets = "clf-orchestrator.socket";

        Restart = "always";
        RestartSec = "2";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ "/var/lib/clf/orchestrator" ];
        UMask = "0077";

        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        LockPersonality = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" "AF_NETLINK" ];
        SystemCallArchitectures = "native";
      };
    };
  };
}
