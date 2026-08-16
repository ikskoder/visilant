{
  description = "Visilant browser extension development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

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
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            pnpm
            just
            # adb, for running the extension on a USB-connected Android phone
            # via `web-ext run -t firefox-android`
            android-tools
          ];

          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath playwrightLibs;

          shellHook = ''
            echo "Welcome to the Visilant development environment!"
            echo "Run 'pnpm install' to install dependencies."
            echo "Run 'just --list' to see all available commands."
          '';
        };
      }
    );
}
