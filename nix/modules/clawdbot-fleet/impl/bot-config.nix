{ config, lib, defs }:

let
  inherit (defs) cfg getBotProfile resolveBotWorkspace botGatewayPort;

  mkSkillEntries = b:
    let
      profile = getBotProfile b;
      entries = profile.skills.entries or {};
      mkEntry = _: entry:
        let
          env = entry.env or {};
          envSecrets = entry.envSecrets or {};
          envDupes = lib.intersectLists (builtins.attrNames env) (builtins.attrNames envSecrets);
          secretEnv = builtins.mapAttrs (_: secretName: config.sops.placeholder.${secretName}) envSecrets;
          apiKey =
            if (entry.apiKeySecret or null) != null
            then config.sops.placeholder.${entry.apiKeySecret}
            else entry.apiKey or null;
          base = lib.optionalAttrs ((entry.enabled or null) != null) { enabled = entry.enabled; }
            // lib.optionalAttrs (apiKey != null) { apiKey = apiKey; }
            // lib.optionalAttrs ((env != {}) || (envSecrets != {})) { env = env // secretEnv; };
        in
          if envDupes != [] then
            throw "services.clawdbotFleet.botProfiles.${b}.skills.entries has duplicate env keys: ${lib.concatStringsSep "," envDupes}"
          else
            lib.recursiveUpdate base (entry.passthrough or {});
    in
      if entries == {} then null else builtins.mapAttrs mkEntry entries;

  mkSkillsConfig = b:
    let
      profile = getBotProfile b;
      allowBundled = profile.skills.allowBundled or null;
      workspace = resolveBotWorkspace b;
      extraDirs = (profile.skills.load or {}).extraDirs or [];
      effectiveExtraDirs = lib.unique ([ "${workspace}/skills" ] ++ extraDirs);
      entries = mkSkillEntries b;
    in
      lib.optionalAttrs (allowBundled != null) { allowBundled = allowBundled; }
      // lib.optionalAttrs (effectiveExtraDirs != []) { load.extraDirs = effectiveExtraDirs; }
      // lib.optionalAttrs (entries != null) { entries = entries; };

  mkBotConfig = b:
    let
      profile = getBotProfile b;
      workspace = resolveBotWorkspace b;
      skipBootstrap =
        if (profile.skipBootstrap or null) != null then profile.skipBootstrap
        else (profile.workspace.seedDir or null) != null;
      modelPrimary = cfg.agentModelPrimary;
      modelEntries =
        if cfg.agentModels != {}
        then cfg.agentModels
        else lib.optionalAttrs (modelPrimary != null) { "${modelPrimary}" = {}; };
      hooksTokenSecret = profile.hooks.tokenSecret or null;
      hooksGmailPushTokenSecret = profile.hooks.gmailPushTokenSecret or null;
      hooksEnabled = profile.hooks.enabled or null;
      hooksConfig =
        lib.optionalAttrs (hooksEnabled != null) { enabled = hooksEnabled; }
        // lib.optionalAttrs (hooksTokenSecret != null) { token = config.sops.placeholder.${hooksTokenSecret}; }
        // lib.optionalAttrs (hooksGmailPushTokenSecret != null) { gmail.pushToken = config.sops.placeholder.${hooksGmailPushTokenSecret}; };
      seedDir = profile.workspace.seedDir or cfg.documentsDir or null;
      includeCfg =
        if seedDir != null && builtins.pathExists (seedDir + "/bots/${b}/clawdbot.json5")
        then { "$include" = "/etc/clawdlets/bots/${b}/clawdbot.json5"; }
        else { };
      gatewayPort =
        if (profile.gatewayPort or null) != null
        then profile.gatewayPort
        else botGatewayPort b;
      userCfg = lib.recursiveUpdate includeCfg (profile.passthrough or { });
      baseCfg = (
        {
          agents = {
            defaults = { }
            // lib.optionalAttrs (modelPrimary != null) { model.primary = modelPrimary; }
            // lib.optionalAttrs (modelEntries != {}) { models = modelEntries; };
          };
        }
        // lib.optionalAttrs (hooksConfig != {}) { hooks = hooksConfig; }
        // lib.optionalAttrs ((mkSkillsConfig b) != {}) { skills = mkSkillsConfig b; }
      );
      invariants = {
        gateway = {
          mode = "local";
          bind = "loopback";
          port = gatewayPort;
          auth = {
            mode = "token";
            token = "\${CLAWDBOT_GATEWAY_TOKEN}";
          };
        };
        agents = {
          defaults = {
            workspace = workspace;
            skipBootstrap = skipBootstrap;
          };
        };
      };
    in
      lib.recursiveUpdate
        (lib.recursiveUpdate baseCfg userCfg)
        invariants;
in
{
  inherit mkSkillEntries mkSkillsConfig mkBotConfig;
}
