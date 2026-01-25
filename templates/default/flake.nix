{
  description = "__PROJECT_NAME__";

  inputs = {
    clawdlets.url = "github:regenrek/clawdlets";
  };

  outputs = { self, clawdlets, ... }:
    let
      system = "x86_64-linux";
      nixpkgs = clawdlets.inputs.nixpkgs;
      lib = nixpkgs.lib;

      cfg = builtins.fromJSON (builtins.readFile ./fleet/clawdlets.json);
      hostNames =
        if builtins.attrNames (cfg.hosts or { }) == [ ] then
          throw "fleet/clawdlets.json must define at least one host under .hosts"
        else
          builtins.attrNames cfg.hosts;
      imageHostNames =
        builtins.filter
          (hostName:
            let
              hostCfg = cfg.hosts.${hostName} or { };
              keys = hostCfg.sshAuthorizedKeys or [ ];
            in
              builtins.isList keys && keys != [ ]
          )
          hostNames;

      project = {
        root = ./.;
        config = cfg;
      };

      flakeInfo = {
        clawdlets = {
          rev = self.rev or null;
          lastModifiedDate = self.lastModifiedDate or null;
        };
        nixpkgs = {
          rev = nixpkgs.rev or null;
          lastModifiedDate = nixpkgs.lastModifiedDate or null;
        };
        nix-clawdbot = {
          rev = clawdlets.inputs.nix-clawdbot.rev or null;
          lastModifiedDate = clawdlets.inputs.nix-clawdbot.lastModifiedDate or null;
        };
        clawdbot =
          if clawdlets.inputs ? clawdbot-src then {
            rev = clawdlets.inputs.clawdbot-src.rev or null;
            lastModifiedDate = clawdlets.inputs.clawdbot-src.lastModifiedDate or null;
          } else {
            rev = null;
            lastModifiedDate = null;
          };
      };
    in {
      nixosConfigurations =
        let
          hostConfigs = lib.genAttrs hostNames (hostName:
            lib.nixosSystem {
              inherit system;
              specialArgs = { inherit clawdlets flakeInfo project; nix-clawdbot = clawdlets.inputs.nix-clawdbot; };
              modules = [
                clawdlets.inputs.disko.nixosModules.disko
                clawdlets.inputs.nixos-generators.nixosModules.all-formats
                clawdlets.inputs.sops-nix.nixosModules.sops
                ({ ... }: { clawdlets.hostName = hostName; })
                clawdlets.nixosModules.clawdletsProjectHost
              ];
            });

          cattleConfig = lib.nixosSystem {
            inherit system;
            specialArgs = { inherit clawdlets flakeInfo project; nix-clawdbot = clawdlets.inputs.nix-clawdbot; };
            modules = [
              clawdlets.inputs.disko.nixosModules.disko
              clawdlets.inputs.nixos-generators.nixosModules.all-formats
              clawdlets.nixosModules.clawdletsCattleImage
            ];
          };
        in
          hostConfigs // {
            clawdlets-cattle = cattleConfig;
          };

      packages = {
        ${system} =
          let
            byHost = builtins.listToAttrs (map (hostName: {
              name = "${hostName}-system";
              value = self.nixosConfigurations.${hostName}.config.system.build.toplevel;
            }) hostNames);
            byHostImages = builtins.listToAttrs (map (hostName: {
              name = "${hostName}-image";
              value = self.nixosConfigurations.${hostName}.config.formats.raw;
            }) imageHostNames);
            first = if hostNames == [ ] then null else builtins.elemAt hostNames 0;
            firstImage = if imageHostNames == [ ] then null else builtins.elemAt imageHostNames 0;
          in
            byHost
            // byHostImages
            // {
              clawdlets-cattle-image = self.nixosConfigurations.clawdlets-cattle.config.formats.raw;
              clawdlets-cattle-system = self.nixosConfigurations.clawdlets-cattle.config.system.build.toplevel;
            }
            // (
              if first == null then
                { }
              else
                {
                  default = byHost."${first}-system";
                }
            )
            // (
              if firstImage == null then
                { defaultImage = self.nixosConfigurations.clawdlets-cattle.config.formats.raw; }
              else
                { defaultImage = byHostImages."${firstImage}-image"; }
            );
      };
    };
}
