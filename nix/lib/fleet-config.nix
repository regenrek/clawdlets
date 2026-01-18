{ lib, project }:
let
  cfg = project.config;
  fleetCfg = (cfg.fleet or { });

  botsById = fleetCfg.bots or { };

  # Single source of truth for bot instances (deterministic order).
  bots =
    let
      order = fleetCfg.botOrder or [ ];
      derived =
        if builtins.isList order && order != [] then order
        else if builtins.isAttrs botsById then builtins.attrNames botsById
        else [ ];
    in
      if derived == [] then builtins.throw "fleet.bots must define at least one bot id"
      else derived;

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

  mkBotProfile = b:
    let
      botCfg = botsById.${b} or { };
      profile = botCfg.profile or { };
      clawdbot = botCfg.clawdbot or { };
      merged = lib.recursiveUpdate baseBot profile;
    in
      merged // { passthrough = lib.recursiveUpdate (merged.passthrough or { }) clawdbot; };
in {
  inherit bots;

  # Workspace seed root (common + per-bot overlay). See fleet/workspaces/.
  documentsDir = project.root + "/fleet/workspaces";

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
}
