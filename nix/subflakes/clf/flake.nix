{
  description = "ClawdletFleet (CLF) - opt-in cattle orchestrator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      clawdletsSrc = ../../..;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: lib.genAttrs systems (system: f system);

      rootSrc = lib.cleanSource clawdletsSrc;

      pnpmWorkspacesClf = [
        "@clawdlets/shared"
        "@clawdlets/cattle-core"
        "@clawdlets/clf-queue"
        "clf"
        "clf-orchestrator"
      ];

      makeClfPackage = system:
        let
          pkgs = import nixpkgs { inherit system; };
          pnpm = pkgs.pnpm_10;
          nodejs = pkgs.nodejs_22;

          pnpmDepsClf = pkgs.fetchPnpmDeps {
            pname = "clawdlets-clf";
            version = "0.1.0";
            src = rootSrc;
            inherit pnpm;
            fetcherVersion = 3;
            pnpmWorkspaces = pnpmWorkspacesClf;
            # CLF-specific hash - update this when pnpm-lock.yaml changes
            hash = "sha256-jC7X3VSifbScBf4dRYb41XK26vaUJXwuahKx0YJe4lk=";
          };
        in
        pkgs.buildNpmPackage {
          pname = "clf";
          version = "0.1.0";
          src = rootSrc;

          inherit nodejs;

          npmDeps = null;
          inherit pnpmDepsClf;
          pnpmDeps = pnpmDepsClf;
          nativeBuildInputs = [ pnpm pkgs.makeWrapper ];
          npmConfigHook = pkgs.pnpmConfigHook;
          inherit pnpmWorkspacesClf;
          pnpmWorkspaces = pnpmWorkspacesClf;

          dontNpmBuild = true;
          dontNpmInstall = true;
          dontNpmPrune = true;

          buildPhase = ''
            runHook preBuild

            # Dependencies are installed by pnpmConfigHook (offline, workspace-scoped via pnpmWorkspacesClf).
            pnpm --filter=@clawdlets/shared build
            pnpm --filter=@clawdlets/cattle-core build
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

            makeWrapper ${nodejs}/bin/node $out/bin/clf \
              --add-flags "$out/lib/clf/packages/clf/cli/dist/main.js"

            makeWrapper ${nodejs}/bin/node $out/bin/clf-orchestrator \
              --add-flags "$out/lib/clf/packages/clf/orchestrator/dist/main.js"

            runHook postInstall
          '';

          meta = {
            description = "ClawdletFleet (bot-facing control plane + orchestrator)";
            mainProgram = "clf";
          };
        };
    in {
      packages = forAllSystems (system: {
        clf = makeClfPackage system;
        default = makeClfPackage system;
      });
    };
}
