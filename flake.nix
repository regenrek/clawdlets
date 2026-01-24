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
      url = "github:clawdbot/clawdbot?rev=975f5a52848fc89208f4c282e20537a40840b32a";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, nix-clawdbot, clawdbot-src, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      dev = import ./devenv.nix { inherit pkgs; };
      clawdbotSourceInfo = import "${nix-clawdbot}/nix/sources/clawdbot-source.nix";

      pnpmWorkspacesClf = [
        "@clawdlets/core"
        "@clawdlets/clf-queue"
        "clf"
        "clf-orchestrator"
      ];

      pnpmDepsClf = pkgs.fetchPnpmDeps {
        pname = "clawdlets-clf";
        version = "0.1.0";
        src = self;
        pnpm = pkgs.pnpm_10;
        fetcherVersion = 3;
        pnpmWorkspaces = pnpmWorkspacesClf;
        hash = "sha256-XkTy04HXmlmQ/KKFlvW+f9HJytLW8J+3FJaNoWiW1jE=";
      };

      clf = pkgs.buildNpmPackage {
        pname = "clf";
        version = "0.1.0";
        src = self;

        nodejs = pkgs.nodejs_22;

        npmDeps = null;
        pnpmDeps = pnpmDepsClf;
        nativeBuildInputs = [ pkgs.pnpm_10 pkgs.makeWrapper ];
        npmConfigHook = pkgs.pnpmConfigHook;
        pnpmWorkspaces = pnpmWorkspacesClf;

        dontNpmBuild = true;
        dontNpmInstall = true;
        dontNpmPrune = true;

        buildPhase = ''
          runHook preBuild

          pnpm --filter=@clawdlets/core build
          pnpm --filter=@clawdlets/clf-queue build
          pnpm --filter=clf build
          pnpm --filter=clf-orchestrator build

          pnpm rebuild better-sqlite3

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          mkdir -p $out/lib/clf
          mkdir -p $out/bin

          cp -r node_modules $out/lib/clf/node_modules
          cp -r packages $out/lib/clf/packages

          makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/clf \
            --add-flags "$out/lib/clf/packages/clf/cli/dist/main.js"

          makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/clf-orchestrator \
            --add-flags "$out/lib/clf/packages/clf/orchestrator/dist/main.js"

          runHook postInstall
        '';

        meta = {
          description = "ClawdletFleet (bot-facing control plane + orchestrator)";
          mainProgram = "clf";
        };
      };
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = dev.packages or [ ];
      };

      packages.${system} = {
        inherit clf pnpmDepsClf;
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
