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
      url = "github:moltbot/moltbot";
      flake = false;
    };

  };

  outputs = { self, nixpkgs, nix-clawdbot, clawdbot-src, ... }:
    let
      systemLinux = "x86_64-linux";
      pkgsLinux = import nixpkgs { system = systemLinux; };
      dev = import ./devenv.nix { pkgs = pkgsLinux; };
      clawdbotSourceInfo = import "${nix-clawdbot}/nix/sources/moltbot-source.nix";

      mkCliPackages = (system:
        let
          pkgs = import nixpkgs { inherit system; };
          lib = pkgs.lib;
          rootSrc = lib.cleanSource ./.;

          pnpm = pkgs.pnpm_10;
          nodejs = pkgs.nodejs_22;

          pnpmWorkspacesCli = [
            "@clawdlets/shared"
            "@clawdlets/cattle-core"
            "@clawdlets/core"
            "clawdlets"
          ];

          pnpmDepsCli = pkgs.fetchPnpmDeps {
            pname = "clawdlets-cli";
            version = "0.4.3";
            src = rootSrc;
            inherit pnpm;
            fetcherVersion = 3;
            pnpmWorkspaces = pnpmWorkspacesCli;
            # Update this when pnpm-lock.yaml changes
            hash = "sha256-A3izetIxONv5hwMCrqqaE4WcJE9RkkSKrSLSGjYyZ9Q=";
          };

          clawdletsCli = pkgs.buildNpmPackage {
            pname = "clawdlets";
            version = "0.4.3";
            src = rootSrc;

            inherit nodejs;

            npmDeps = null;
            inherit pnpmDepsCli;
            pnpmDeps = pnpmDepsCli;
            nativeBuildInputs = [ pnpm pkgs.makeWrapper ];
            npmConfigHook = pkgs.pnpmConfigHook;
            inherit pnpmWorkspacesCli;
            pnpmWorkspaces = pnpmWorkspacesCli;

            dontNpmBuild = true;
            dontNpmInstall = true;
            dontNpmPrune = true;

            buildPhase = ''
              runHook preBuild

              # Dependencies are installed by pnpmConfigHook (offline, workspace-scoped).
              pnpm --filter=@clawdlets/shared build
              pnpm --filter=@clawdlets/cattle-core build
              pnpm --filter=@clawdlets/core build
              pnpm --filter=clawdlets build

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p $out/lib/clawdlets
              mkdir -p $out/bin

              cp -r node_modules $out/lib/clawdlets/node_modules
              cp -r packages $out/lib/clawdlets/packages

              makeWrapper ${nodejs}/bin/node $out/bin/clawdlets \
                --add-flags "$out/lib/clawdlets/packages/cli/dist/main.mjs" \
                --prefix PATH : ${pkgs.minisign}/bin

              runHook postInstall
            '';

            meta = {
              description = "clawdlets CLI";
              mainProgram = "clawdlets";
            };
          };
        in
          {
            clawdlets = clawdletsCli;
            default = clawdletsCli;
          }
      );
    in {
      devShells.${systemLinux}.default = pkgsLinux.mkShell {
        packages = dev.packages or [ ];
      };

      packages.${systemLinux} = mkCliPackages systemLinux;
      packages.aarch64-darwin = mkCliPackages "aarch64-darwin";

      checks.${systemLinux} = {
        clawdbot-pin-align = pkgsLinux.runCommand "clawdbot-pin-align" {} ''
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
