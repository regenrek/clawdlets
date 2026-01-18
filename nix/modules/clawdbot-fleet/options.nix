{ lib, pkgs, nix-clawdbot, ... }:

let
  system = pkgs.system;
  clawdbotPkgs =
    nix-clawdbot.packages.${system} or
      (throw "nix-clawdbot.packages.${system} missing (must consume flake outputs, not outPath internals)");

  normalizeJson = v: builtins.fromJSON (builtins.toJSON v);
in {
  options.services.clawdbotFleet = {
    enable = lib.mkEnableOption "Clawdbot fleet";

    package = lib.mkOption {
      type = lib.types.package;
      default = clawdbotPkgs.clawdbot-gateway;
      description = "Clawdbot package used by fleet services.";
    };

    tools = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Install the optional Clawdbot tools bundle into the system PATH.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = clawdbotPkgs.clawdbot-tools;
        description = "Clawdbot tools package installed when tools.enable is true.";
      };
    };

    codex = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Install the Codex CLI on the host (headless usage).";
      };
      bots = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Bots expected to use Codex CLI (for documentation + onboarding).";
      };
    };

    bots = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "maren" "sonja" "gunnar" "melinda" ];
      description = "Bot instance names (also used for system users).";
    };

    gatewayPortBase = lib.mkOption {
      type = lib.types.int;
      default = 18789;
      description = "Base port for per-bot gateway servers.";
    };

    gatewayPortStride = lib.mkOption {
      type = lib.types.int;
      default = 20;
      description = "Port stride per bot (port = base + bot index * stride).";
    };

    githubSync = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Periodically sync GitHub PRs/issues into each bot workspace memory dir (pure IO inventory).";
      };
      schedule = lib.mkOption {
        type = lib.types.str;
        default = "*:0/15";
        description = "systemd OnCalendar schedule for GitHub sync (default: every 15 minutes).";
      };
      org = lib.mkOption {
        type = lib.types.str;
        default = "clawdbot";
        description = "GitHub org to sync when repos is empty.";
      };
      repos = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Optional explicit repo list (owner/repo). When set, org listing is skipped.";
      };
    };

    opsSnapshot = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Write periodic host ops snapshots to disk (no secrets; for debugging and drift detection).";
      };
      schedule = lib.mkOption {
        type = lib.types.str;
        default = "daily";
        description = "systemd OnCalendar schedule for ops snapshot.";
      };
      outDir = lib.mkOption {
        type = lib.types.str;
        default = "/var/lib/clawdlets/ops/snapshots";
        description = "Directory holding JSON snapshots (latest.json + timestamped files).";
      };
      keepDays = lib.mkOption {
        type = lib.types.int;
        default = 30;
        description = "Retention: delete snapshot files older than this many days (0 disables).";
      };
      keepLast = lib.mkOption {
        type = lib.types.int;
        default = 200;
        description = "Retention: keep at most this many snapshot files (0 disables).";
      };
    };

    agentModelPrimary = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Default model for agents (provider/model), e.g. zai/glm-4.7.";
    };

    agentModels = lib.mkOption {
      type = lib.types.attrs;
      default = {};
      description = "Additional model entries for agents.defaults.models.";
    };

    documentsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Optional workspace seed root for docs and prompt policy.

        Expected structure:
        - common/<files> (shared)
        - bots/<bot>/<files> (per-bot overrides; overlay on common)

        On start:
        - seeds empty workspaces (common then bot overlay)
        - syncs a managed allowlist (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, USER.md, HEARTBEAT.md) into the workspace
      '';
    };

    disableBonjour = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Disable Bonjour/mDNS discovery (sets CLAWDBOT_DISABLE_BONJOUR=1).";
    };

    hardening = {
      nodeExecMem = lib.mkOption {
        type = lib.types.enum [ "jit" "jitless" ];
        default = "jit";
        description = ''
          Node/V8 execution mode.

          - jit: allows W^X violations (required for default Node JIT); sets MemoryDenyWriteExecute=false.
          - jitless: sets MemoryDenyWriteExecute=true and sets NODE_OPTIONS=--jitless (may impact performance/compat).
        '';
      };
    };

    resources = {
      memoryMax = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = "4G";
        description = "systemd MemoryMax default for bot services (null disables).";
      };
      cpuQuota = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = "200%";
        description = "systemd CPUQuota default for bot services (null disables).";
      };
      tasksMax = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = 4096;
        description = "systemd TasksMax default for bot services (null disables).";
      };
      ioWeight = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = "systemd IOWeight default for bot services (null disables).";
      };
    };

    botProfiles = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
        options = {
          skipBootstrap = lib.mkOption {
            type = lib.types.nullOr lib.types.bool;
            default = null;
            description = "Override agents.defaults.skipBootstrap for this bot (defaults true when workspace.seedDir is set).";
          };

          env = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Per-bot service env vars (non-secret).";
          };

          envSecrets = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Map of env var name -> sops secret name for bot service env.";
          };

          workspace = {
            dir = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Workspace directory (defaults to <stateDir>/workspace).";
            };
            seedDir = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "Optional per-bot workspace seed root (same overlay structure as services.clawdbotFleet.documentsDir); also enables managed-docs sync on each start.";
            };
          };

          skills = {
            allowBundled = lib.mkOption {
              type = lib.types.nullOr (lib.types.listOf lib.types.str);
              default = null;
              description = "Per-bot skills.allowBundled (bundled skill allowlist).";
            };
            load = {
              extraDirs = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [];
                description = "Per-bot skills.load.extraDirs.";
              };
            };
            entries = lib.mkOption {
              type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
                options = {
                  enabled = lib.mkOption {
                    type = lib.types.nullOr lib.types.bool;
                    default = null;
                    description = "Enable/disable the skill explicitly.";
                  };
                  apiKey = lib.mkOption {
                    type = lib.types.nullOr lib.types.str;
                    default = null;
                    description = "Inline apiKey (prefer apiKeySecret for secrets).";
                  };
                  apiKeySecret = lib.mkOption {
                    type = lib.types.nullOr lib.types.str;
                    default = null;
                    description = "Sops secret name used as skills.entries.<skill>.apiKey.";
                  };
                  env = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "Inline env vars merged into skills.entries.<skill>.env.";
                  };
                  envSecrets = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "Map of env var name -> sops secret name (injected into skills.entries.<skill>.env).";
                  };
                  passthrough = lib.mkOption {
                    type = lib.types.attrs;
                    default = {};
                    apply = normalizeJson;
                    description = "Additional per-skill config (passthrough; forward-compat).";
                  };
                };
              }));
              default = {};
              description = "Per-bot skills.entries with secret injection support.";
            };
          };

          hooks = {
            enabled = lib.mkOption {
              type = lib.types.nullOr lib.types.bool;
              default = null;
              description = "Per-bot hooks.enabled (set true to enable webhooks).";
            };
            tokenSecret = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Sops secret name used as hooks.token.";
            };
            gmailPushTokenSecret = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Sops secret name used as hooks.gmail.pushToken.";
            };
          };

          github = {
            appId = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "GitHub App ID used to mint installation tokens for gh/git.";
            };
            installationId = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "GitHub App installation ID for the target org/repo set.";
            };
            privateKeySecret = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Sops secret name containing the GitHub App private key PEM.";
            };
            refreshMinutes = lib.mkOption {
              type = lib.types.int;
              default = 45;
              description = "Refresh interval for GitHub installation tokens (minutes).";
            };
          };

          passthrough = lib.mkOption {
            type = lib.types.attrs;
            default = {};
            apply = normalizeJson;
            description = "Extra Clawdbot config merged into this bot's root config (passthrough; forward-compat).";
          };

          gatewayPort = lib.mkOption {
            type = lib.types.nullOr lib.types.int;
            default = null;
            description = "Optional per-bot gateway port override (otherwise computed from gatewayPortBase/Stride).";
          };

          resources = {
            memoryMax = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Per-bot override for MemoryMax (null uses global default).";
            };
            cpuQuota = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Per-bot override for CPUQuota (null uses global default).";
            };
            tasksMax = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "Per-bot override for TasksMax (null uses global default).";
            };
            ioWeight = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "Per-bot override for IOWeight (null uses global default).";
            };
          };
        };
      }));
      default = {};
      description = "Per-bot profile config (service/runtime + secret injection + passthrough).";
    };

    backups = {
      restic = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Enable restic backups for the fleet state dirs.";
        };
        repository = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Restic repository (e.g. s3:s3.amazonaws.com/bucket/path).";
        };
        passwordSecret = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Sops secret name containing the restic repository password.";
        };
        environmentSecret = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Optional sops secret name containing restic env file contents (AWS_* etc).";
        };
        paths = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [];
          description = "Paths to back up (empty => defaults to stateDirBase).";
        };
        timerConfig = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { OnCalendar = "daily"; RandomizedDelaySec = "1h"; Persistent = "true"; };
          description = "systemd timer config for restic backup job.";
        };
      };
    };

    stateDirBase = lib.mkOption {
      type = lib.types.str;
      default = "/srv/clawdbot";
      description = "Base directory for per-bot state dirs.";
    };
  };
}
