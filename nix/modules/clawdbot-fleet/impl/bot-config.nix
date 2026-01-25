{ lib, defs }:

let
  inherit (defs)
    cfg
    getBotProfile
    resolveBotWorkspace
    botGatewayPort
    isNonEmptyString
    envRef
    hooksTokenEnvVar
    hooksGmailPushTokenEnvVar
    skillApiKeyEnvVar;

  mkSkillEntries = b:
    let
      profile = getBotProfile b;
      entries = profile.skills.entries or {};
      mkEntry = skill: entry:
        let
          env = entry.env or {};
          apiKeySecret = entry.apiKeySecret or null;
          apiKey =
            if isNonEmptyString apiKeySecret
            then envRef (skillApiKeyEnvVar skill)
            else entry.apiKey or null;
          base = lib.optionalAttrs ((entry.enabled or null) != null) { enabled = entry.enabled; }
            // lib.optionalAttrs (apiKey != null) { apiKey = apiKey; }
            // lib.optionalAttrs (env != {}) { env = env; };
        in
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
        // lib.optionalAttrs (isNonEmptyString hooksTokenSecret) { token = envRef hooksTokenEnvVar; }
        // lib.optionalAttrs (isNonEmptyString hooksGmailPushTokenSecret) { gmail.pushToken = envRef hooksGmailPushTokenEnvVar; };
      gatewayPort =
        if (profile.gatewayPort or null) != null
        then profile.gatewayPort
        else botGatewayPort b;
      userCfg = profile.passthrough or { };
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
