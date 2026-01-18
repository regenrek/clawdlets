{ config, lib, pkgs, ... }:

let
  cfg = config.clawdlets;
in {
  options.clawdlets.selfUpdate = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable cache-only self-updates from a signed/pinned deploy manifest URL.";
    };

    manifestUrl = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "URL to the deploy manifest JSON for this host (cache-only).";
    };

    interval = lib.mkOption {
      type = lib.types.str;
      default = "30min";
      description = "systemd OnCalendar value for self-update checks.";
    };

    publicKey = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Minisign public key for manifest signature verification (optional).";
    };

    signatureUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "URL to the minisign signature for the manifest (required if publicKey is set).";
    };
  };

  config = {
    assertions = [
      {
        assertion = (!cfg.selfUpdate.enable) || (cfg.selfUpdate.manifestUrl != "");
        message = "clawdlets.selfUpdate.manifestUrl must be set when self-update is enabled.";
      }
      {
        assertion =
          (!cfg.selfUpdate.enable)
          || (cfg.selfUpdate.publicKey == null)
          || (cfg.selfUpdate.signatureUrl != null && cfg.selfUpdate.signatureUrl != "");
        message = "clawdlets.selfUpdate.signatureUrl must be set when publicKey is configured.";
      }
    ];

    systemd.services.clawdlets-self-update = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawdlets self-update (cache-only manifest)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = [ pkgs.bash pkgs.curl pkgs.jq pkgs.coreutils pkgs.gnugrep pkgs.minisign ];
      environment = lib.mkMerge [
        { CLAWDLETS_SELF_UPDATE_MANIFEST_URL = cfg.selfUpdate.manifestUrl; }
        (lib.optionalAttrs (cfg.selfUpdate.publicKey != null) {
          CLAWDLETS_SELF_UPDATE_PUBLIC_KEY = cfg.selfUpdate.publicKey;
          CLAWDLETS_SELF_UPDATE_SIGNATURE_URL = cfg.selfUpdate.signatureUrl;
        })
      ];
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        UMask = "0077";
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        NoNewPrivileges = true;
        ReadWritePaths = [ "/nix" "/var" ];
      };
      script = ''
        set -euo pipefail

        tmpdir="$(mktemp -d)"
        trap 'rm -rf "''${tmpdir}"' EXIT

        manifest="''${tmpdir}/manifest.json"
        curl -fsSL --retry 3 --retry-delay 2 -o "''${manifest}" "''${CLAWDLETS_SELF_UPDATE_MANIFEST_URL}"

        if [[ -n "''${CLAWDLETS_SELF_UPDATE_PUBLIC_KEY:-}" ]]; then
          sig="''${tmpdir}/manifest.minisig"
          if [[ -z "''${CLAWDLETS_SELF_UPDATE_SIGNATURE_URL:-}" ]]; then
            echo "error: signature URL missing" >&2
            exit 2
          fi
          curl -fsSL --retry 3 --retry-delay 2 -o "''${sig}" "''${CLAWDLETS_SELF_UPDATE_SIGNATURE_URL}"
          minisign -Vm "''${manifest}" -P "''${CLAWDLETS_SELF_UPDATE_PUBLIC_KEY}" -x "''${sig}"
        fi

        host="$(jq -r '.host // empty' "''${manifest}")"
        rev="$(jq -r '.rev // empty' "''${manifest}")"
        toplevel="$(jq -r '.toplevel // empty' "''${manifest}")"

        if [[ -z "''${host}" || "''${host}" != "${config.networking.hostName}" ]]; then
          echo "error: manifest host mismatch (''${host})" >&2
          exit 2
        fi

        if [[ ! "''${rev}" =~ ^[0-9a-f]{40}$ ]]; then
          echo "error: invalid rev in manifest" >&2
          exit 2
        fi

        if [[ -z "''${toplevel}" || "''${toplevel}" =~ [[:space:]] || "''${toplevel}" != /nix/store/* ]]; then
          echo "error: invalid toplevel in manifest" >&2
          exit 2
        fi

        /etc/clawdlets/bin/switch-system --toplevel "''${toplevel}" --rev "''${rev}"
      '';
    };

    systemd.timers.clawdlets-self-update = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawdlets self-update timer";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = cfg.selfUpdate.interval;
        Persistent = true;
        RandomizedDelaySec = "2m";
        Unit = "clawdlets-self-update.service";
      };
    };
  };
}
