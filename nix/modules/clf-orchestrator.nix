{ config, lib, pkgs, clawdlets ? null, project, ... }:

let
  system = pkgs.system;

  # CLF package resolution:
  # 1. Try clawdlets.inputs.clf (subflake - recommended)
  # 2. Fall back to clawdlets.packages.clf (if provided)
  # 3. null if neither available
  clfSubflake =
    if clawdlets != null && (clawdlets ? inputs) && (clawdlets.inputs ? clf)
    then clawdlets.inputs.clf
    else null;

  defaultClfPackage =
    if clfSubflake != null
    then clfSubflake.packages.${system}.clf or null
    else if clawdlets != null && (clawdlets ? packages) && (clawdlets.packages ? ${system})
    then clawdlets.packages.${system}.clf or null
    else null;

  fleetCfg = project.config;
  cattleCfg = fleetCfg.cattle or { };
  cattleHetzner = cattleCfg.hetzner or { };
  cattleDefaults = cattleCfg.defaults or { };

  secretEnv = fleetCfg.fleet.secretEnv or { };
  secretEnvSecretNames =
    lib.unique (builtins.filter (s: s != null && s != "") (builtins.attrValues secretEnv));

  tailscaleSecret =
    if (config ? clawdlets) && (config.clawdlets ? tailnet) && (config.clawdlets.tailnet ? tailscale)
    then config.clawdlets.tailnet.tailscale.authKeySecret or null
    else null;

  personasDir = project.root + "/cattle/personas";
  personasExists = builtins.pathExists personasDir;
  personaNames =
    if !personasExists
    then [ ]
    else
      builtins.filter (n:
        let t = (builtins.readDir personasDir).${n} or null;
        in t == "directory"
      ) (builtins.attrNames (builtins.readDir personasDir));

  mkPersonaEtc = name:
    let
      base = "clf/cattle-personas/${name}";
      soul = "${personasDir}/${name}/SOUL.md";
      cfg = "${personasDir}/${name}/config.json";
    in
      lib.optionalAttrs (builtins.pathExists soul) {
        "${base}/SOUL.md" = { source = soul; mode = "0444"; };
      }
      // lib.optionalAttrs (builtins.pathExists cfg) {
        "${base}/config.json" = { source = cfg; mode = "0444"; };
      };

  mkEnvLine = envVar: value: "${envVar}=${value}";

  cfg = config.services.clfOrchestrator;
  clawdbotBots = lib.attrByPath [ "services" "clawdbotFleet" "bots" ] [ ] config;
  adminAuthorizedKeys = lib.attrByPath [ "users" "users" "admin" "openssh" "authorizedKeys" "keys" ] [ ] config;
in
{
  options.services.clfOrchestrator = {
    enable = lib.mkEnableOption "ClawdletFleet orchestrator (jobs queue + cattle spawner)";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = defaultClfPackage;
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

  config = lib.mkMerge [
    (lib.mkIf cfg.enable {
      assertions = [
        {
          assertion = cfg.package != null;
          message = "services.clfOrchestrator.package must be set (provide clawdlets flake input or set services.clfOrchestrator.package explicitly).";
        }
        {
          assertion = cfg.cattle.image != "";
          message = "services.clfOrchestrator.cattle.image must be set (or set cattle.hetzner.image in fleet/clawdlets.json).";
        }
        {
          assertion = tailscaleSecret != null && tailscaleSecret != "";
          message = "clawdlets.tailnet.tailscale.authKeySecret must be set (needed to spawn cattle with tailscale).";
        }
      ];
    })
    (lib.mkIf (cfg.enable && cfg.package != null) {
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
        }) clawdbotBots))
      ];

      environment.systemPackages = [ cfg.package ];

      environment.etc = lib.mkMerge (
        [
          {
            "clf/admin_authorized_keys" = {
              mode = "0444";
              text = lib.concatStringsSep "\n" (adminAuthorizedKeys ++ [ "" ]);
            };
          }
        ]
        ++ (map mkPersonaEtc personaNames)
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
        }) secretEnvSecretNames))
      ];

      sops.templates."clf-orchestrator.env" = {
        owner = "clf-orchestrator";
        group = "clf-orchestrator";
        mode = "0400";
        content =
          lib.concatStringsSep "\n" (
            (lib.optional (cfg.hcloudTokenSecret != "")
              "HCLOUD_TOKEN=${config.sops.placeholder.${cfg.hcloudTokenSecret}}"
            )
            ++ [
              "TAILSCALE_AUTH_KEY=${config.sops.placeholder.${tailscaleSecret}}"
            ]
            ++ (lib.mapAttrsToList (envVar: secretName: mkEnvLine envVar config.sops.placeholder.${toString secretName}) secretEnv)
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

          CLF_CATTLE_PERSONAS_ROOT = "/etc/clf/cattle-personas";
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
    })
  ];
}
