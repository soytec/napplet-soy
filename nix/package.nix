{
  pkgs,
  src,
  systems,
}:
let
  inherit (pkgs) lib stdenvNoCC;

  version = (lib.importJSON ../apps/cli/distribution/version.json).version;
  toolchain = lib.importJSON ../apps/cli/vendor/toolchain.json;
  rootPackage = lib.importJSON ../package.json;
  bunVersion = lib.removePrefix "bun@" rootPackage.packageManager;
  playwrightVersion = rootPackage.devDependencies."@playwright/test";

  # Release builds are pinned to one Bun version (scripts/cli-build.ts); keep Nix on it.
  bun = pkgs.bun.overrideAttrs (
    finalAttrs: previous: {
      version = bunVersion;
      src =
        finalAttrs.passthru.sources.${stdenvNoCC.hostPlatform.system}
          or (throw "soyli: Bun ${bunVersion} is not packaged for ${stdenvNoCC.hostPlatform.system}");
      passthru = previous.passthru // {
        sources = {
          "x86_64-linux" = pkgs.fetchurl {
            url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-x64-baseline.zip";
            hash = "sha256-q+NG9jQUVHzfazW3pkmkkMcouT0AYiYVaSORioTA5Zs=";
          };
          "aarch64-linux" = pkgs.fetchurl {
            url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-aarch64.zip";
            hash = "sha256-0TlE2hKlPsx0v2pyC9HQTEVVwDjf5CI2U1anvkdpH98=";
          };
        };
      };
    }
  );

  # soyLI checks the exact Node version and Playwright browser revisions at runtime.
  nodejs =
    assert lib.assertMsg (pkgs.nodejs_24.version == toolchain.node.version)
      "soyli pins Node ${toolchain.node.version} (apps/cli/vendor/toolchain.json) but nixpkgs has ${pkgs.nodejs_24.version}.";
    pkgs.nodejs_24;
  playwrightBrowsers =
    assert lib.assertMsg (
      pkgs.playwright-driver.version == playwrightVersion
    ) "soyli pins Playwright ${playwrightVersion} but nixpkgs has ${pkgs.playwright-driver.version}.";
    pkgs.playwright-driver.browsers.override {
      withFirefox = false;
      withWebkit = false;
    };

  pnpm = stdenvNoCC.mkDerivation {
    pname = "soyli-pnpm";
    version = toolchain.pnpm.version;
    src = pkgs.fetchurl {
      url = toolchain.pnpm.url;
      hash = toolchain.pnpm.integrity;
    };
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      mkdir -p "$out"
      cp -R . "$out/package"
    '';
  };

  # Only manifests and the lockfile, so source edits do not refetch dependencies.
  dependencySource = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../apps/cli/package.json
      ../apps/cvm/package.json
      ../apps/web/package.json
    ];
  };

  nodeModules = stdenvNoCC.mkDerivation {
    pname = "soyli-node-modules";
    inherit version;
    src = dependencySource;

    impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [
      "GIT_PROXY_COMMAND"
      "SOCKS_SERVER"
    ];

    nativeBuildInputs = [
      bun
      pkgs.writableTmpDirAsHomeHook
    ];

    dontConfigure = true;

    # Development dependencies are needed: the build bundles preview assets and
    # ships playwright-core next to the binary.
    buildPhase = ''
      runHook preBuild

      export BUN_INSTALL_CACHE_DIR="$(mktemp -d)"
      bun install \
        --cpu="*" \
        --os="*" \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress

      # Bun 1.3.11 races when linking bins between cyclic peer dependencies
      # (browserslist, webpack, ...): https://github.com/oven-sh/bun/issues/30209.
      # Which links appear depends on download timing, so identical locked
      # dependencies hash differently across machines. These store-internal
      # .bin directories only serve lifecycle scripts, which --ignore-scripts
      # skips; drop them all. Top-level and workspace .bin links are kept.
      find node_modules/.bun -mindepth 3 -maxdepth 3 -name .bin -type d -exec rm -rf {} +

      # The playwright-core-mac-compat alias races the real playwright-core for
      # the store's fallback link. Point it at the version locked by name.
      playwrightCore=node_modules/.bun/playwright-core@${playwrightVersion}/node_modules/playwright-core
      if [ ! -f "$playwrightCore/package.json" ]; then
        echo "soyli: locked playwright-core ${playwrightVersion} is missing from node_modules/.bun" >&2
        exit 1
      fi
      ln -sfn "../playwright-core@${playwrightVersion}/node_modules/playwright-core" \
        node_modules/.bun/node_modules/playwright-core

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"
      cp -R node_modules "$out/"
      for workspace in apps/*; do
        if [ -d "$workspace/node_modules" ]; then
          mkdir -p "$out/$workspace"
          cp -R "$workspace/node_modules" "$out/$workspace/"
        fi
      done

      runHook postInstall
    '';

    # Fixup can embed host-specific Nix store paths in the fixed-output tree.
    dontFixup = true;

    outputHash = "sha256-FebtGCjq6TDb4qvr+MpkmBH5bUgoLCMmjN2l+9sUlLc=";
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  };

  soyli = stdenvNoCC.mkDerivation {
    pname = "soyli";
    inherit version src;

    nativeBuildInputs = [
      bun
      pkgs.makeWrapper
      pkgs.writableTmpDirAsHomeHook
    ];

    configurePhase = ''
      runHook preConfigure

      cp -R ${nodeModules}/. .
      chmod -R u+w node_modules apps

      runHook postConfigure
    '';

    buildPhase = ''
      runHook preBuild

      bun scripts/cli-compile.ts "$PWD/soyli" ${version} \
        --preview-assets \
        --distribution nix

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      # Same layout as a release archive: lib/ sits next to the real executable.
      libexec="$out/libexec/soyli"
      mkdir -p "$libexec/lib" "$out/bin" "$out/share/doc/soyli"
      install -m 755 soyli "$libexec/soyli"
      cp -RL node_modules/.bun/playwright-core@${playwrightVersion}/node_modules/playwright-core \
        "$libexec/lib/playwright-core"
      cp -RL "$(dirname "$(bun -e 'console.log(require.resolve("ws/package.json"))')")" \
        "$libexec/lib/ws"
      cp LICENSE apps/cli/distribution/NOTICE.txt "$out/share/doc/soyli/"

      # Bun.secrets dlopens libsecret and glib. The loader reads LD_LIBRARY_PATH once at
      # startup; soyli then restores the caller's value so child processes (git, browsers,
      # xdg-open) do not inherit these libraries.
      makeWrapper "$libexec/soyli" "$out/bin/soyli" \
        --set SOYLI_NODE ${lib.getExe nodejs} \
        --set SOYLI_PNPM ${pnpm}/package/bin/pnpm.cjs \
        --set-default PLAYWRIGHT_BROWSERS_PATH ${playwrightBrowsers} \
        --run 'export SOYLI_HOST_LD_LIBRARY_PATH="''${LD_LIBRARY_PATH-}"' \
        --prefix LD_LIBRARY_PATH : ${
          lib.makeLibraryPath [
            pkgs.libsecret
            pkgs.glib
          ]
        } \
        --suffix PATH : ${lib.makeBinPath [ pkgs.git ]}
      # Older generated projects can keep using their original command.
      ln -s soyli "$out/bin/napplet-space"

      runHook postInstall
    '';

    # A compiled Bun executable carries its bundle after the ELF image; stripping drops it.
    dontStrip = true;

    passthru = {
      inherit
        bun
        nodeModules
        nodejs
        pnpm
        playwrightBrowsers
        ;
    };

    meta = {
      description = "soyLI, the napplet.soy creator CLI";
      homepage = "https://napplet.soy";
      license = lib.licenses.mit;
      mainProgram = "soyli";
      platforms = systems;
    };
  };
in
{
  default = soyli;
  inherit soyli nodeModules;
}
