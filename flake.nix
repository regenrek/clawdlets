{
  description = "Clawdlets CLI (infra lives in clawdlets-template)";

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
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      dev = import ./devenv.nix { inherit pkgs; };

      pnpmDeps = pkgs.fetchPnpmDeps {
        pname = "clawdlets";
        version = "0.1.0";
        src = self;
        pnpm = pkgs.pnpm_9;
        fetcherVersion = 2;
        hash = "sha256-82+2327S+OKVbdIoLWY1kiELD0Ok0/2Xj3/g4If4wW0=";
      };

      clf = pkgs.buildNpmPackage {
        pname = "clf";
        version = "0.1.0";
        src = self;

        nodejs = pkgs.nodejs_22;

        npmDeps = null;
        pnpmDeps = pnpmDeps;
        nativeBuildInputs = [ pkgs.pnpm_9 pkgs.makeWrapper ];
        npmConfigHook = pkgs.pnpmConfigHook;

        dontNpmBuild = true;
        dontNpmInstall = true;
        dontNpmPrune = true;

        buildPhase = ''
          runHook preBuild

          pnpm -C packages/core build
          pnpm -C packages/clf/queue build
          pnpm -C packages/clf/cli build
          pnpm -C packages/clf/orchestrator build

          pnpm --offline rebuild better-sqlite3

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          mkdir -p $out/lib/clf/packages/clf
          mkdir -p $out/lib/clf/packages/core
          mkdir -p $out/bin

          cp -r node_modules $out/lib/clf/node_modules
          cp -r packages/core $out/lib/clf/packages/core
          cp -r packages/clf $out/lib/clf/packages/clf

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
        inherit clf;
      };
    };
}
