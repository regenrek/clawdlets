{
  description = "Clawdlets (CLI + infra framework)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";

    nixos-generators.url = "github:nix-community/nixos-generators";
    nixos-generators.inputs.nixpkgs.follows = "nixpkgs";

    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";

    nix-clawdbot.url = "github:clawdbot/nix-clawdbot";
    nix-clawdbot.inputs.nixpkgs.follows = "nixpkgs";

    clawdbot-src = {
      url = "github:clawdbot/clawdbot";
      flake = false;
    };

  };

  outputs = { self, nixpkgs, nix-clawdbot, clawdbot-src, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      dev = import ./devenv.nix { inherit pkgs; };
      clawdbotSourceInfo = import "${nix-clawdbot}/nix/sources/clawdbot-source.nix";
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = dev.packages or [ ];
      };

      checks.${system} = {
        clawdbot-pin-align = pkgs.runCommand "clawdbot-pin-align" {} ''
          set -euo pipefail
          pinned_rev="${clawdbotSourceInfo.rev or ""}"
          src_rev="${clawdbot-src.rev or ""}"

          if [ -z "$pinned_rev" ] || [ -z "$src_rev" ]; then
            echo "error: missing clawdbot rev (nix-clawdbot pinned=$pinned_rev clawdbot-src=$src_rev)" >&2
            exit 1
          fi

          if [ "$pinned_rev" != "$src_rev" ]; then
            echo "error: clawdbot-src rev mismatch (nix-clawdbot=$pinned_rev clawdbot-src=$src_rev)" >&2
            exit 1
          fi

          touch "$out"
        '';
      };

      nixosModules = {
        clawdletsProjectHost = import ./nix/hosts/project-host.nix;
        clawdletsCattleImage = import ./nix/cattle/image.nix;

        # Advanced / reuse. Projects should generally import clawdletsProjectHost only.
        clawdletsHostMeta = import ./nix/modules/clawdlets-host-meta.nix;
        clawdletsHostBaseline = import ./nix/modules/clawdlets-host-baseline.nix;
        clawdletsSelfUpdate = import ./nix/modules/clawdlets-self-update.nix;
        clawdletsImageFormats = import ./nix/modules/clawdlets-image-formats.nix;

        clawdbotFleet = import ./nix/modules/clawdbot-fleet.nix;
        clawdbotCattle = import ./nix/modules/clawdbot-cattle.nix;
        clfOrchestrator = import ./nix/modules/clf-orchestrator.nix;

        diskoHetznerExt4 = import ./nix/disko/hetzner-ext4.nix;
      };
    };
}
