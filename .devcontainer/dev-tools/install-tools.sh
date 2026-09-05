#!/usr/bin/env bash
# Tools that are downloaded rather than installed from a distribution: the
# command runner and the secret scanner.
#
# Every download is checked against a sha256 recorded here, so a version and its
# checksum are always edited together and a substituted binary fails the build
# rather than the morning. Both are also present on the host, where they come
# from the Nix devshell - a git hook that calls a tool the host does not have
# quietly degrades into no check at all.
set -euo pipefail

# Pinned to the version flake.nix hands the host devshell. The two run the same
# recipes, so a version skew between them is a difference nobody would look for.
JUST_VERSION="1.43.1"
JUST_SHA256_amd64="6a3003f68fa4d86ada8afe33830a88ffdb6c2fcaff4e5a840b1cb90eaf6f46fc"
JUST_SHA256_arm64="e28e1f18cecd45d35f9fb39ef3651dd79c0623cb29a2f375ea7a1a185ac32dc9"

GITLEAKS_VERSION="8.30.1"
GITLEAKS_SHA256_amd64="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
GITLEAKS_SHA256_arm64="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"

case "$(dpkg --print-architecture)" in
  amd64) arch=amd64; just_target="x86_64-unknown-linux-musl"; gitleaks_target="linux_x64" ;;
  arm64) arch=arm64; just_target="aarch64-unknown-linux-musl"; gitleaks_target="linux_arm64" ;;
  *) echo "Unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# fetch <url> <dest> <sha256>
fetch() {
  curl --fail --silent --show-error --location --retry 3 --output "$2" "$1"
  echo "$3  $2" | sha256sum --check --status \
    || { echo "Checksum mismatch for $1" >&2; exit 1; }
}

just_sha="JUST_SHA256_${arch}"
fetch "https://github.com/casey/just/releases/download/${JUST_VERSION}/just-${JUST_VERSION}-${just_target}.tar.gz" \
      "$work/just.tar.gz" "${!just_sha}"
tar -xzf "$work/just.tar.gz" -C "$work" just
install -m 0755 "$work/just" /usr/local/bin/just

gitleaks_sha="GITLEAKS_SHA256_${arch}"
fetch "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${gitleaks_target}.tar.gz" \
      "$work/gitleaks.tar.gz" "${!gitleaks_sha}"
tar -xzf "$work/gitleaks.tar.gz" -C "$work" gitleaks
install -m 0755 "$work/gitleaks" /usr/local/bin/gitleaks

# Smoke test, so a pin that no longer resolves breaks here rather than in use.
just --version
gitleaks version
