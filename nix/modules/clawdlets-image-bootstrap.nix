{ lib, ... }:
{
  config = {
    clawdlets.bootstrap.allowMissingSecrets = true;
    clawdlets.cache.garnix.private.enable = lib.mkForce false;
    services.clawdbotFleet.enable = lib.mkForce false;
  };
}
