{ config, lib, pkgs, project, flakeInfo ? {}, ... }:

let
  cfg = config.services.clawdbotFleet;
  knownBundledSkills = builtins.fromJSON (builtins.readFile (project.root + "/fleet/bundled-skills.json"));

  defaultHostSecretsDir = "/var/lib/clawdlets/secrets/hosts/${config.networking.hostName}";
  resolvedSopsDir =
    if (config ? clawdlets)
       && (config.clawdlets ? secrets)
       && ((config.clawdlets.secrets.hostDir or null) != null)
    then config.clawdlets.secrets.hostDir
    else defaultHostSecretsDir;

  sopsSecrets = import ../../../lib/sops-secrets.nix { };
  mkSopsSecretFor = sopsSecrets.mkSopsSecretFor { hostDir = resolvedSopsDir; };

  resticPaths =
    if cfg.backups.restic.paths != []
    then cfg.backups.restic.paths
    else [ cfg.stateDirBase ] ++ lib.optional cfg.opsSnapshot.enable cfg.opsSnapshot.outDir;

  getBotProfile = b: cfg.botProfiles.${b} or {
    skipBootstrap = null;
    workspace = { dir = null; seedDir = null; };
    secretEnv = {};
    secretEnvAllowlist = null;
    secretFiles = {};
    skills = {};
    hooks = {};
    github = {};
    passthrough = {};
    resources = {};
  };

  isNonEmptyString = v: v != null && toString v != "";

  normalizeEnvKey = name:
    let
      raw = toString name;
      replaced = lib.replaceStrings [ "-" "." "/" " " ] [ "_" "_" "_" "_" ] raw;
    in
      lib.toUpper replaced;

  envRef = envVar: "\${${envVar}}";

  hooksTokenEnvVar = "CLAWDBOT_HOOKS_TOKEN";
  hooksGmailPushTokenEnvVar = "CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN";
  skillApiKeyEnvVar = skill: "CLAWDBOT_SKILL_${normalizeEnvKey skill}_API_KEY";

  buildDerivedSecretEnv = profile:
    let
      hooks = profile.hooks or {};
      entries = (profile.skills.entries or {});
      hooksEnv =
        lib.optionalAttrs (isNonEmptyString (hooks.tokenSecret or null)) { "${hooksTokenEnvVar}" = hooks.tokenSecret; }
        // lib.optionalAttrs (isNonEmptyString (hooks.gmailPushTokenSecret or null)) {
          "${hooksGmailPushTokenEnvVar}" = hooks.gmailPushTokenSecret;
        };
      skillEnv =
        builtins.listToAttrs (lib.concatLists (lib.mapAttrsToList (skill: entry:
          let
            secret = entry.apiKeySecret or null;
          in
            if isNonEmptyString secret
            then [ { name = skillApiKeyEnvVar skill; value = secret; } ]
            else [ ]
        ) entries));
    in
      hooksEnv // skillEnv;

  buildBaseSecretEnv = profile: (cfg.secretEnv or {}) // (profile.secretEnv or {});
  buildEffectiveSecretEnv = profile: (buildBaseSecretEnv profile) // (buildDerivedSecretEnv profile);
  secretEnvDerivedDupes = profile:
    lib.intersectLists
      (builtins.attrNames (buildBaseSecretEnv profile))
      (builtins.attrNames (buildDerivedSecretEnv profile));

  resolveBotWorkspace = b:
    let
      profile = getBotProfile b;
      stateDir = "${cfg.stateDirBase}/${b}";
    in
      if (profile.workspace.dir or null) != null then profile.workspace.dir else "${stateDir}/workspace";

  resolveBotCredsDir = b: "${cfg.stateDirBase}/${b}/credentials";

  hasGitHubAppAuth =
    lib.any (b:
      let
        gh = (getBotProfile b).github or {};
      in
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null
    ) cfg.bots;

  hasCodingAgent =
    lib.any (b:
      let
        allowBundled = ((getBotProfile b).skills.allowBundled or null);
      in
        allowBundled != null && lib.elem "coding-agent" allowBundled
    ) cfg.bots;

  hasGithubSkill =
    lib.any (b:
      let
        allowBundled = ((getBotProfile b).skills.allowBundled or null);
      in
        allowBundled != null && lib.elem "github" allowBundled
    ) cfg.bots;

  hasGh = hasGithubSkill || hasCodingAgent || cfg.githubSync.enable;

  hasCodex =
    cfg.codex.enable
    || cfg.codex.bots != []
    || hasCodingAgent;

  toolsInventoryMd = pkgs.runCommand "clawdlets-tools.md" {} ''
    set -euo pipefail

    cat >"$out" <<'MD'
## Installed tools (generated)

Do not edit. Generated from NixOS config.

- Base: `clawdbot` (gateway) + `git` + `jq`
MD

    ${lib.optionalString cfg.tools.enable ''
    cat >>"$out" <<'MD'

### Tool bundle binaries
MD
    if [ -d "${cfg.tools.package}/bin" ]; then
      ls -1 "${cfg.tools.package}/bin" | LC_ALL=C sort | sed 's/^/- `/' | sed 's/$/`/' >>"$out"
    else
      echo "- (missing \`bin/\`)" >>"$out"
    fi
    ''}

    ${lib.optionalString (!cfg.tools.enable) ''
    cat >>"$out" <<'MD'

- Tool bundle: disabled (`services.clawdbotFleet.tools.enable = false`)
MD
    ''}

    ${lib.optionalString hasCodex ''
    cat >>"$out" <<MD

### Codex CLI (headless)

- Installed: \`codex\`
- Login (one-time): \`sudo -u bot-<bot> env HOME=${cfg.stateDirBase}/<bot> codex login --device-auth\`
MD
    ''}
  '';

  buildInfoJson = pkgs.writeText "clawdlets-build-info.json" (builtins.toJSON flakeInfo);

  botIndexByName = lib.listToAttrs (lib.imap0 (i: name: { name = name; value = i; }) cfg.bots);
  botIndex = b: botIndexByName.${b} or (throw "unknown bot index for ${b}");
  botGatewayPort = b: cfg.gatewayPortBase + ((botIndex b) * cfg.gatewayPortStride);
in
{
  inherit
    cfg
    knownBundledSkills
    resolvedSopsDir
    mkSopsSecretFor
    resticPaths
    getBotProfile
    resolveBotWorkspace
    resolveBotCredsDir
    hasGitHubAppAuth
    hasCodingAgent
    hasGithubSkill
    hasGh
    hasCodex
    toolsInventoryMd
    buildInfoJson
    botGatewayPort
    isNonEmptyString
    normalizeEnvKey
    envRef
    hooksTokenEnvVar
    hooksGmailPushTokenEnvVar
    skillApiKeyEnvVar
    buildDerivedSecretEnv
    buildBaseSecretEnv
    buildEffectiveSecretEnv
    secretEnvDerivedDupes;
}
