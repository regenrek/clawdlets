{ lib, ... }:
{
  options.clawdlets = {
    hostName = lib.mkOption {
      type = lib.types.str;
      default = "CHANGE_ME_HOSTNAME";
      description = "Host name used for networking.hostName.";
      example = "clawdbot-fleet-host";
    };

    nameservers = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        # Cloudflare (v4/v6). Override if you prefer other resolvers.
        "1.1.1.1"
        "1.0.0.1"
        "2606:4700:4700::1111"
        "2606:4700:4700::1001"
      ];
      description = "DNS resolver IPs used for networking.nameservers.";
    };

    diskDevice = lib.mkOption {
      type = lib.types.str;
      default = "/dev/sda";
      description = "Primary disk device used by disko.";
      example = "/dev/nvme0n1";
    };
  };
}
