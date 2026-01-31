{ lib, ... }:
{
  config = {
    clawdlets.bootstrap.allowMissingSecrets = true;
    clawdlets.cache.netrc.enable = lib.mkForce false;
    services.clawdbotFleet.enable = lib.mkForce false;
  };
}
