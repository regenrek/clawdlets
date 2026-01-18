{ config, lib, pkgs, defs, botConfig }:

let
  inherit (defs)
    cfg
    getBotProfile
    resolveBotWorkspace
    resolveBotCredsDir
    mkSopsSecretFor;

  inherit (botConfig) mkBotConfig;

  mkBotSkillSecrets = b:
    let
      profile = getBotProfile b;
      entries = profile.skills.entries or {};
      botEnvSecrets = builtins.attrValues (profile.envSecrets or {});
      hooksSecrets =
        (lib.optional ((profile.hooks.tokenSecret or null) != null) profile.hooks.tokenSecret)
        ++ (lib.optional ((profile.hooks.gmailPushTokenSecret or null) != null) profile.hooks.gmailPushTokenSecret);
      githubSecrets =
        lib.optional ((profile.github.privateKeySecret or null) != null) profile.github.privateKeySecret;
      perEntrySecrets = lib.concatLists (lib.mapAttrsToList (_: entry:
        (lib.optional ((entry.apiKeySecret or null) != null) entry.apiKeySecret)
        ++ (builtins.attrValues (entry.envSecrets or {}))
      ) entries);
      allSecrets = lib.unique (lib.filter (s: s != null && s != "") (hooksSecrets ++ githubSecrets ++ perEntrySecrets ++ botEnvSecrets));
    in
      builtins.listToAttrs (map (secretName: { name = secretName; value = mkSopsSecretFor secretName; }) allSecrets);

  mkTemplate = b:
    {
      "clawdbot-${b}.json" = {
        owner = "bot-${b}";
        group = "bot-${b}";
        mode = "0400";
        # Important: keep template content pure at eval time.
        # `builtins.readFile (pkgs.formats.json.generate ...)` forces a local build/eval-store write,
        # which breaks remote-build workflows on hosts that reject unsigned local store paths.
        content = builtins.toJSON (mkBotConfig b);
      };
    };

  mkEnvTemplate = b:
    let
      profile = getBotProfile b;
      envSecrets = profile.envSecrets or {};
      secretEnv = builtins.mapAttrs (_: secretName: config.sops.placeholder.${secretName}) envSecrets;
      lines = lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "${k}=${v}") secretEnv);
    in
      lib.optionalAttrs (secretEnv != {}) {
        "clawdbot-${b}.env" = {
          owner = "bot-${b}";
          group = "bot-${b}";
          mode = "0400";
          content = lines + "\n";
        };
      };

  mkBotUser = b: {
    name = "bot-${b}";
    value =
      let
        stateDir = "${cfg.stateDirBase}/${b}";
      in {
        isSystemUser = true;
        group = "bot-${b}";
        home = stateDir;
        createHome = false;
        shell = pkgs.bashInteractive;
      };
  };

  mkBotGroup = b: { name = "bot-${b}"; value = {}; };

  mkStateDir = b:
    let
      dir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      credsDir = resolveBotCredsDir b;
    in [
      "d ${dir} 0700 bot-${b} bot-${b} - -"
      "d ${workspace} 0700 bot-${b} bot-${b} - -"
      "d ${credsDir} 0700 bot-${b} bot-${b} - -"
    ];

  mkService = b:
    let
      stateDir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      profile = getBotProfile b;
      cfgPath = "/run/secrets/rendered/clawdbot-${b}.json";
      clawPkg = cfg.package;
      seedDir = profile.workspace.seedDir or cfg.documentsDir or null;
      credsDir = resolveBotCredsDir b;
      gatewayEnvFile = "${credsDir}/gateway.env";
      env = profile.env or {};
      envSecrets = profile.envSecrets or {};
      envDupes = lib.intersectLists (builtins.attrNames env) (builtins.attrNames envSecrets);
      botResources = profile.resources or {};
      memoryMax =
        if (botResources.memoryMax or null) != null
        then botResources.memoryMax
        else cfg.resources.memoryMax;
      cpuQuota =
        if (botResources.cpuQuota or null) != null
        then botResources.cpuQuota
        else cfg.resources.cpuQuota;
      tasksMax =
        if (botResources.tasksMax or null) != null
        then botResources.tasksMax
        else cfg.resources.tasksMax;
      ioWeight =
        if (botResources.ioWeight or null) != null
        then botResources.ioWeight
        else cfg.resources.ioWeight;

      egressMode =
        if (config ? clawdlets) && (config.clawdlets ? egress) then config.clawdlets.egress.mode else "smtp-only";
      proxyEnabled = egressMode == "proxy-allowlist";
      proxyPort =
        if proxyEnabled && (config.clawdlets.egress.proxy.port or null) != null
        then config.clawdlets.egress.proxy.port
        else 3128;
      proxyUrl = "http://127.0.0.1:${toString proxyPort}";
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      ghEnvFile = "${credsDir}/gh.env";
      envSecretsFile =
        if envSecrets == {}
        then null
        else "/run/secrets/rendered/clawdbot-${b}.env";
    in
      {
        name = "clawdbot-${b}";
        value = {
          description = "Clawdbot Discord gateway (${b})";
          wantedBy = [ "multi-user.target" ];
          after =
            [ "network-online.target" "sops-nix.service" "clawdbot-gateway-token-${b}.service" ]
            ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service"
            ++ lib.optional proxyEnabled "clawdlets-egress-proxy.service";
          wants =
            [ "network-online.target" "sops-nix.service" "clawdbot-gateway-token-${b}.service" ]
            ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service"
            ++ lib.optional proxyEnabled "clawdlets-egress-proxy.service";

          environment =
            if envDupes != []
            then throw "services.clawdbotFleet.botProfiles.${b}.envSecrets has duplicate env keys: ${lib.concatStringsSep "," envDupes}"
            else {
              CLAWDBOT_NIX_MODE = "1";
              CLAWDBOT_STATE_DIR = stateDir;
              CLAWDBOT_CONFIG_PATH = cfgPath;
              HOME = stateDir;
            }
            // lib.optionalAttrs cfg.disableBonjour { CLAWDBOT_DISABLE_BONJOUR = "1"; }
            // lib.optionalAttrs (cfg.hardening.nodeExecMem == "jitless") { NODE_OPTIONS = "--jitless"; }
            // lib.optionalAttrs (seedDir != null) {
              CLAWDLETS_BOT_ID = b;
              CLAWDLETS_WORKSPACE_DIR = workspace;
              CLAWDLETS_SEED_DIR = toString seedDir;
              CLAWDLETS_TOOLS_MD = "/etc/clawdlets/tools.md";
            }
            // lib.optionalAttrs proxyEnabled {
              HTTP_PROXY = proxyUrl;
              HTTPS_PROXY = proxyUrl;
              ALL_PROXY = proxyUrl;
              http_proxy = proxyUrl;
              https_proxy = proxyUrl;
              all_proxy = proxyUrl;
              NO_PROXY = "localhost,127.0.0.1,::1";
              no_proxy = "localhost,127.0.0.1,::1";
            }
            // env;

          serviceConfig = {
            User = "bot-${b}";
            Group = "bot-${b}";
            WorkingDirectory = stateDir;

            ExecStartPre = lib.optionals (seedDir != null) [
              "/etc/clawdlets/bin/seed-workspace"
              "/etc/clawdlets/bin/sync-managed-docs"
            ];
            ExecStart = "${clawPkg}/bin/clawdbot gateway";

            Restart = "always";
            RestartSec = "3";

            EnvironmentFile = lib.flatten [
              gatewayEnvFile
              (lib.optional (envSecretsFile != null) "-${envSecretsFile}")
              (lib.optional ghEnabled "-${ghEnvFile}")
            ];

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = lib.unique [ stateDir workspace ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            # Node/V8 JIT needs to toggle executable memory permissions.
            MemoryDenyWriteExecute = cfg.hardening.nodeExecMem != "jit";
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          }
          // lib.optionalAttrs (memoryMax != null) { MemoryMax = memoryMax; }
          // lib.optionalAttrs (cpuQuota != null) { CPUQuota = cpuQuota; }
          // lib.optionalAttrs (tasksMax != null) { TasksMax = tasksMax; }
          // lib.optionalAttrs (ioWeight != null) { IOWeight = ioWeight; }
          // lib.optionalAttrs proxyEnabled {
            IPAddressDeny = "any";
            IPAddressAllow = [ "127.0.0.1" "::1" ];
          };
        };
      };

  perBotSkillSecrets = lib.mkMerge (map mkBotSkillSecrets cfg.bots);
  perBotTemplates = lib.mkMerge (map mkTemplate cfg.bots);
  perBotEnvTemplates = lib.mkMerge (map mkEnvTemplate cfg.bots);
in
{
  inherit
    mkBotUser
    mkBotGroup
    mkStateDir
    mkService
    perBotSkillSecrets
    perBotTemplates
    perBotEnvTemplates;
}
