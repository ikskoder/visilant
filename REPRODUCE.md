# Reproducible builds

Every release of Visilant can be rebuilt from source, by anyone, down to the
byte. This page is the recipe and the proof.

The point is narrow but useful: it lets you check that the extension your
browser downloaded from the store is the code published in this repository, and
nothing else.

## What is pinned

| Input | Pinned by |
|---|---|
| nixpkgs revision, and with it the compiler toolchain | `flake.lock` |
| Node.js 22.21.1, pnpm 10.22.0 | `flake.nix` (`nodejs_22`, `pnpm`), repeated in `package.json` |
| Every npm dependency, by integrity hash | `pnpm-lock.yaml`, installed with `--frozen-lockfile` |
| Which source files enter the build | the file list in `flake.nix` – an allowlist, so a stray file in a working copy cannot change the output |
| Timestamps, entry order and permissions inside the archive | [scripts/pack.ts](scripts/pack.ts) – one fixed date, paths sorted, mode 0644 |

The build itself is offline. Only the dependency fetch touches the network, and
it is content-addressed: if a package on the registry ever changed, the hash in
`flake.nix` would stop matching and the build would fail rather than quietly
produce something else.

## Rebuild it

With [Nix](https://nixos.org/download/) installed and flakes enabled:

```bash
nix build github:ikskoder/visilant/v3.1.3#firefox
sha256sum result/*.xpi
```

Use `#chrome` for the Chrome zip. Compare the hash with `SHA256SUMS` attached to
[the release](https://github.com/ikskoder/visilant/releases) of the same tag. It
has to match exactly.

The same works from a clone:

```bash
git checkout v3.1.3
nix build .#firefox
cat result/SHA256SUMS
```

Once a build is in the store, `nix build .#firefox --rebuild` builds it again
from scratch and fails if any byte of the result differs. `just nix-check` does
that for both targets, and CI runs it on every build.

### Without Nix

Node 22.21.1 and pnpm 10.22.0 give the same archive on a normal Linux machine:

```bash
pnpm install --frozen-lockfile
pnpm build-firefox && pnpm pack:xpi   # or: pnpm build && pnpm pack:zip
sha256sum artifacts/*
```

This is how AMO reviewers build the submitted source. It matches, but only Nix
pins the toolchain itself, so treat a mismatch here as a question about your
Node version before assuming anything about the release.

## Check the copy your browser installed

A store package can never equal the archive we build, byte for byte: AMO wraps
the xpi in its own signature under `META-INF/`, and Chrome re-packs the zip
inside a signed CRX container. So the comparison is done on the contents, file
by file:

```bash
scripts/verify.sh path/to/downloaded.xpi
```

It builds the reference itself (`--built result` reuses one you already have),
unpacks the downloaded package, and compares every file. Store-added paths –
`META-INF/`, `_metadata/`, `mozilla-recommendation.json` – are listed and
skipped, because they are not built from source. Anything else that differs, is
missing, or is unexpectedly present makes it exit non-zero.

Where to get the installed package:

- Firefox: `about:support` – Profile Folder – `extensions/visilant@….xpi`, or
  the "Download" link on the AMO version history page.
- Chrome: the unpacked copy under `Extensions/<id>/<version>/` in the profile
  directory, which `scripts/verify.sh --target chrome --built result` can be
  pointed at after zipping, or a `.crx` pulled from the Web Store.

## Check who built it

Release archives carry a [build
provenance](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds)
attestation, signed through Sigstore. It ties the file to the commit and the
workflow that produced it:

```bash
gh attestation verify visilant-3.1.3-firefox.xpi --repo ikskoder/visilant
```

That is a statement about the builder. The hash comparison above is a statement
about the source. They are worth having together and neither replaces the other.

## Check it without trusting us

The hashes in a release are published by the same people who cut the release,
which is exactly the thing you may not want to take on faith. So rebuild it
somewhere we do not control:

1. Fork this repository.
2. Actions – **reproduce** – Run workflow.
3. Pick the tag and the target.

The job builds on GitHub's runners and compares the result with the hash
published for that tag. It also runs weekly on the default branch, so a build
that stops reproducing is noticed.

## When a rebuild does not match

Open an issue with the tag, the hash you got, the hash you expected, and how you
built it. A mismatch is either a bug in the pinning or something worse, and both
are worth knowing about.
