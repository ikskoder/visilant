# Build instructions

Full detail, including how to check a release against the copy a store served
you, is in [REPRODUCE.md](REPRODUCE.md). This file is the short version for a
reviewer who only needs the artifact.

## The canonical build

Releases are built with [Nix](https://nixos.org/download/), which pins the whole
toolchain through `flake.lock`:

```
nix build .#firefox     # -> result/visilant-<version>-firefox.xpi
nix build .#chrome      # -> result/visilant-<version>-chrome.zip
```

`result/SHA256SUMS` holds the hash of the archive, `result/SHA256SUMS-unpacked`
the hash of every file inside it.

## Without Nix

Requires Node 22.21.1 and pnpm 10.22.0 – the versions the flake pins, repeated
in `package.json`. Tested on Ubuntu 24.04.

```
pnpm install --frozen-lockfile
pnpm build-firefox
pnpm pack:xpi
```

The archive lands in `artifacts/`. Packaging is deterministic on purpose, so the
result matches the published hash for the same commit.

The extension is based on the
[vitesse-webext](https://github.com/antfu-collective/vitesse-webext) template.
