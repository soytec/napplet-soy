{
  description = "soyLI - the napplet.soy creator CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      # Darwin needs the separate macOS-compatible Playwright build; not packaged yet.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f system (
            import nixpkgs {
              inherit system;
            }
          )
        );

      sourceExclusions = [
        ".git"
        ".github"
        ".local"
        ".output"
        ".planning"
        ".tanstack"
        "AGENDA.md"
        "dist"
        "node_modules"
        "output"
        "playwright-report"
        "result"
        "test-results"
      ];

      cleanSource = nixpkgs.lib.cleanSourceWith {
        src = ./.;
        filter = path: _type: !(nixpkgs.lib.elem (baseNameOf path) sourceExclusions);
      };

      # Only package inputs: docs, maintenance scripts and local files should not
      # change the compiled CLI. Still exclude generated files within these trees.
      src = nixpkgs.lib.fileset.toSource {
        root = ./.;
        fileset = nixpkgs.lib.fileset.intersection (nixpkgs.lib.fileset.fromSource cleanSource) (
          nixpkgs.lib.fileset.unions [
            ./LICENSE
            ./package.json
            ./bun.lock
            ./apps/cli
            # soyLI reuses Studio's inference settings UI and credential service.
            ./apps/studio/connections-model.ts
            ./apps/studio/connections-ui.tsx
            ./apps/studio/connections.ts
            ./apps/studio/inference-jobs.ts
            ./apps/studio/model-catalogue.ts
            ./apps/studio/model-picker-ui.tsx
            ./apps/cvm/package.json
            ./apps/web/package.json
            ./apps/web/src
            ./apps/web/public
            ./packages
            ./scripts/cli-compile.ts
            # These guides are embedded in generated creator workspaces.
            ./docs/NIP5D-CREATOR.md
            ./docs/RUNTIME-ACTIONS.md
            ./docs/CONTROLLERS.md
            ./docs/MOBILE.md
            ./docs/WASM.md
            ./docs/VISUAL-DESIGN.md
            ./docs/BACKEND-CREATOR.md
            ./docs/DYNAMIC-BACKENDS-CREATOR.md
            ./docs/SHARED-DATA.md
            ./docs/OUTBOX.md
            ./docs/examples/coordinated-audio.ts
          ]
        );
      };
    in
    {
      nixosModules = {
        soyli = import ./nix/module.nix self;
        default = self.nixosModules.soyli;
      };

      overlays.default = final: _prev: {
        soyli = self.packages.${final.stdenv.hostPlatform.system}.soyli;
      };

      packages = forAllSystems (
        _system: pkgs:
        import ./nix/package.nix {
          inherit pkgs src systems;
        }
      );

      apps = forAllSystems (
        system: _pkgs: {
          default = {
            type = "app";
            program = "${nixpkgs.lib.getExe self.packages.${system}.default}";
            meta.description = "Run soyLI";
          };
        }
      );

      devShells = forAllSystems (
        system: pkgs:
        let
          soyli = self.packages.${system}.soyli;
        in
        {
          default = pkgs.mkShell {
            packages = [
              soyli.passthru.bun
              soyli.passthru.nodejs
              pkgs.git
            ];
          };
        }
      );

      checks = forAllSystems (
        system: pkgs:
        {
          package = self.packages.${system}.default;
        }
        // nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          nixos-module = pkgs.testers.runNixOSTest (import ./nix/test.nix { inherit self; });
        }
      );
    };
}
