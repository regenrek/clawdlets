{ config, lib, pkgs, defs }:

let
  inherit (defs) cfg getBotProfile resolveBotWorkspace resolveBotCredsDir;

  mkGithubTokenService = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      enabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      stateDir = "${cfg.stateDirBase}/${b}";
      credsDir = resolveBotCredsDir b;
      envFile = "${credsDir}/gh.env";
      gitCredsFile = "${credsDir}/git-credentials";
      gitConfigFile = "${stateDir}/.gitconfig";
      privateKeyPath = config.sops.secrets.${gh.privateKeySecret}.path;
      appId = toString gh.appId;
      installationId = toString gh.installationId;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-token-${b}" = {
          description = "Mint GitHub App installation token for bot ${b}";
          after = [ "network-online.target" "sops-nix.service" ];
          wants = [ "network-online.target" "sops-nix.service" ];
          path = [ pkgs.coreutils pkgs.curl pkgs.openssl pkgs.jq ];
          environment = {
            CLAWDLETS_GH_APP_ID = appId;
            CLAWDLETS_GH_INSTALLATION_ID = installationId;
            CLAWDLETS_GH_PRIVATE_KEY_PATH = privateKeyPath;
            CLAWDLETS_GH_ENV_FILE = envFile;
            CLAWDLETS_GH_GIT_CREDENTIALS_FILE = gitCredsFile;
            CLAWDLETS_GH_GITCONFIG_FILE = gitConfigFile;
            CLAWDLETS_BOT_USER = "bot-${b}";
            CLAWDLETS_BOT_GROUP = "bot-${b}";
          };
          serviceConfig = {
            Type = "oneshot";
            ExecStart = "/etc/clawdlets/bin/gh-mint-app-token";

            User = "root";
            Group = "root";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = [ stateDir ];
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

  mkGithubTokenTimer = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      enabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      refreshMinutes = toString (gh.refreshMinutes or 45);
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-token-${b}" = {
          description = "Refresh GitHub App token for bot ${b}";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnBootSec = "2m";
            OnUnitActiveSec = "${refreshMinutes}m";
            RandomizedDelaySec = "2m";
            Persistent = true;
            Unit = "clawdbot-gh-token-${b}.service";
          };
        };
      };

  mkGithubSyncService = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      stateDir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      credsDir = resolveBotCredsDir b;
      ghEnvFile = "${credsDir}/gh.env";
      reposEnv = lib.concatStringsSep " " cfg.githubSync.repos;
      enabled = cfg.githubSync.enable && ghEnabled;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-sync-${b}" = {
          description = "Sync GitHub PRs/issues into bot workspace memory (${b})";
          after = [ "network-online.target" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          wants = [ "network-online.target" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          serviceConfig = {
            Type = "oneshot";
            User = "bot-${b}";
            Group = "bot-${b}";
            WorkingDirectory = stateDir;
            EnvironmentFile = lib.optional ghEnabled "-${ghEnvFile}";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = lib.unique [ stateDir workspace ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
          path = [ pkgs.bash pkgs.coreutils pkgs.gh pkgs.jq ];
          environment = {
            GH_PAGER = "cat";
            GIT_PAGER = "cat";
            MEMORY_DIR = "${workspace}/memory";
            ORG = cfg.githubSync.org;
          } // lib.optionalAttrs (cfg.githubSync.repos != []) { REPOS = reposEnv; };
          script = ''
            exec /etc/clawdlets/bin/gh-sync
          '';
        };
      };

  mkGithubSyncTimer = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      enabled = cfg.githubSync.enable && ghEnabled;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-sync-${b}" = {
          description = "Periodic GitHub sync for bot ${b}";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnCalendar = cfg.githubSync.schedule;
            RandomizedDelaySec = "2m";
            Persistent = true;
            Unit = "clawdbot-gh-sync-${b}.service";
          };
        };
      };
in
{
  inherit mkGithubTokenService mkGithubTokenTimer mkGithubSyncService mkGithubSyncTimer;
}
