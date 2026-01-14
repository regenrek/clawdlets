{ lib }:
let
  cfg = builtins.fromJSON (builtins.readFile ../../fleet/clawdlets.json);
  fleetCfg = cfg.fleet or { };

  # Single source of truth for bot instances.
  bots = fleetCfg.bots or [ "maren" "sonja" "gunnar" "melinda" ];

  baseBot = {
    envSecrets = fleetCfg.envSecrets or { };
    skills = {
      # Explicit allowlist required on servers. Avoid null (typically means “allow all bundled skills”).
      allowBundled = [ ];
      entries = { };
    };
    gatewayPort = null;
    passthrough = { };
  };

  mkBot = overrides: lib.recursiveUpdate baseBot overrides;

  botOverrides = fleetCfg.botOverrides or { };

  mkBotProfile = b: mkBot (botOverrides.${b} or { });

  defaultRouting = {
    channels = [ ];
    requireMention = true;
  };

  routingOverrides = fleetCfg.routingOverrides or { };
in {
  inherit bots;

  # set this to your Discord guild/server id
  guildId = fleetCfg.guildId or "";

  # Workspace seed root (common + per-bot overlay). See fleet/workspaces/.
  documentsDir = ../../fleet/workspaces;
  identity = null;

  codex = {
    enable = (fleetCfg.codex or { }).enable or false;
    bots = (fleetCfg.codex or { }).bots or [ ];
  };

  botProfiles = lib.genAttrs bots mkBotProfile;

  backups = {
    restic = {
      enable = ((fleetCfg.backups or { }).restic or { }).enable or false;
      repository = ((fleetCfg.backups or { }).restic or { }).repository or "";
      passwordSecret = "restic_password";
      environmentSecret = null;
    };
  };

  routing = lib.recursiveUpdate
    (lib.genAttrs bots (_: defaultRouting))
    routingOverrides;
}
