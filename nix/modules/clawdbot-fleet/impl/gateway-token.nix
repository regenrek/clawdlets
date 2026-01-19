{ config, lib, pkgs, defs }:

let
  inherit (defs) resolveBotCredsDir;

  mkGatewayTokenService = b:
    let
      credsDir = resolveBotCredsDir b;
      envFile = "${credsDir}/gateway.env";
    in
      {
        "clawdbot-gateway-token-${b}" = {
          description = "Ensure Gateway auth token for bot ${b}";
          path = [ pkgs.bash pkgs.coreutils pkgs.openssl ];
          environment = {
            CLAWDLETS_GATEWAY_ENV_FILE = envFile;
            CLAWDLETS_BOT_USER = "bot-${b}";
            CLAWDLETS_BOT_GROUP = "bot-${b}";
          };
          serviceConfig = {
            Type = "oneshot";
            ExecStart = "/etc/clawdlets/bin/ensure-gateway-token";

            User = "root";
            Group = "root";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = [ credsDir ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
        };
      };
in
{
  inherit mkGatewayTokenService;
}
