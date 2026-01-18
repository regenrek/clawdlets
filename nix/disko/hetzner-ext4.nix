{ config, ... }:
{
  # Example disk layout (Hetzner). Override `clawdlets.diskDevice` if needed.
  disko.devices = {
    disk.main = {
      device = config.clawdlets.diskDevice;
      type = "disk";
      content = {
        type = "gpt";
        partitions = {
          bios = {
            size = "1M";
            type = "EF02";
          };
          root = {
            size = "100%";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
            };
          };
        };
      };
    };
  };
}
