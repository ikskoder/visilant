{
  description = "Visilant browser extension – reproducible builds and dev shell";

  inputs = {
    # flake.lock pins the exact nixpkgs revision, and with it the exact node,
    # pnpm and every build tool. That lock is what makes a build from a given
    # commit reproducible years later, so update it deliberately, not by habit.
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        inherit (pkgs) lib;

        # These two decide the build output. package.json repeats them in
        # `engines` and `packageManager` for people building without Nix, and
        # the versions have to stay in step.
        nodejs = pkgs.nodejs_22;
        pnpm = pkgs.pnpm;

        pname = "visilant";
        version = (lib.importJSON ./package.json).version;

        # An allowlist, not a filter. Anything a working copy happens to carry –
        # key.pem, artifacts, .direnv, an editor's scratch file – stays out of
        # the store, so a dirty checkout still builds the same bytes.
        source = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./package.json
            ./pnpm-lock.yaml
            ./.npmrc
            ./tsconfig.json
            ./modules.d.ts
            ./shim.d.ts
            ./unocss.config.ts
            ./vite.config.mts
            ./vite.config.background.mts
            ./vite.config.content.mts
            ./vite.config.frame.mts
            ./scripts
            ./src
            ./extension/_locales
            ./extension/assets
          ];
        };

        # The dependency fetch is the only step allowed near the network, and it
        # is content-addressed: the hash below is the whole node_modules tree.
        # Refresh it whenever pnpm-lock.yaml changes: build once and copy the
        # hash Nix reports as `got:`.
        pnpmDeps = pnpm.fetchDeps {
          inherit pname version;
          fetcherVersion = 2;
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [ ./package.json ./pnpm-lock.yaml ./.npmrc ];
          };
          hash = "sha256-VJPo+OsjdHUMaNlkOi/d8c83r8UcgyuIE2E3+AACtmo=";
        };

        # target: "chrome" | "firefox"
        mkExtension = target:
          let
            artifact = if target == "firefox"
              then "visilant-${version}-firefox.xpi"
              else "visilant-${version}-chrome.zip";
          in
          pkgs.stdenv.mkDerivation {
            pname = "${pname}-${target}";
            inherit version pnpmDeps;
            src = source;

            nativeBuildInputs = [ nodejs pnpm.configHook ];

            # Nix already exports SOURCE_DATE_EPOCH=315532800, which is what
            # scripts/pack.ts stamps on every zip entry.
            buildPhase = ''
              runHook preBuild
              pnpm run ${if target == "firefox" then "build-firefox" else "build"}
              pnpm run ${if target == "firefox" then "pack:xpi" else "pack:zip"}
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p $out
              cp artifacts/${artifact} $out/
              cp -r extension $out/unpacked

              # Per-file hashes as well as the archive hash: a store-signed xpi
              # can never match the archive byte for byte, so verification is
              # done on the contents. See REPRODUCE.md.
              ( cd $out/unpacked && find . -type f | LC_ALL=C sort \
                  | xargs sha256sum ) > $out/SHA256SUMS-unpacked
              ( cd $out && sha256sum ${artifact} ) > $out/SHA256SUMS

              runHook postInstall
            '';

            dontFixup = true;

            meta = {
              description = "Visilant packed for ${target}";
              homepage = "https://github.com/ikskoder/visilant";
              license = lib.licenses.mit;
              platforms = lib.platforms.all;
            };
          };

        # Shared libraries required by Playwright's bundled Chromium
        playwrightLibs = with pkgs; [
          glib
          nss
          nspr
          atk
          at-spi2-atk
          cups.lib
          dbus.lib
          libdrm
          expat
          mesa
          libgbm
          pango
          cairo
          alsa-lib
          libx11
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxrandr
          libxcb
          libxshmfence
          vulkan-loader
          libxkbcommon
          systemd
        ];
      in
      {
        packages = {
          firefox = mkExtension "firefox";
          chrome = mkExtension "chrome";
          default = mkExtension "firefox";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pnpm
            pkgs.just
            # adb, for running the extension on a USB-connected Android phone
            # via `web-ext run -t firefox-android`
            pkgs.android-tools
            # The secret scanner the pre-commit hook calls. It has to be on the
            # HOST, not only in the dev container: a hook that calls a tool the
            # host does not have degrades into no check at all, and a hook that
            # silently checks nothing is worse than none, because everybody
            # stops thinking about it.
            pkgs.gitleaks
          ];

          LD_LIBRARY_PATH = lib.makeLibraryPath playwrightLibs;

          shellHook = ''
            echo "Welcome to the Visilant development environment!"
            echo "Run 'pnpm install' to install dependencies."
            echo "Run 'just --list' to see all available commands."
          '';
        };
      }
    );
}
