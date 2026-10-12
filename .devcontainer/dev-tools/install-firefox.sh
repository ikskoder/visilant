#!/usr/bin/env bash
# Two stock Firefox builds for the desktop Firefox e2e suite (`just fe`).
#
# Playwright cannot load an extension into Firefox, so e2e-firefox/ drives a
# stock Firefox over WebDriver BiDi, and that Firefox has to come from somewhere.
# Two of them, because they disagree in ways the suite has caught: ESR 140 is
# the oldest the manifest admits (`strict_min_version`), and the current release
# is what most people, phones included, actually run.
#
# Official Mozilla builds only. Every tarball is checked against a sha512 kept
# here, so a version and its checksum are always edited together. The sums were
# taken from Mozilla's SHA512SUMS for each release, whose signature verified
# against Mozilla's release key ("Mozilla Software Releases", signing subkey
# 827E658608679618CD349F93678E455D76767AA3) when they were pinned.
#
# Moving a pin: take the new version's line for each architecture from
# https://archive.mozilla.org/pub/firefox/releases/<version>/SHA512SUMS, and
# check SHA512SUMS.asc against the KEY file beside it.
set -euo pipefail

FIREFOX_ESR_VERSION="140.17.0esr"
FIREFOX_ESR_SHA512_amd64="fb3cba21b6f9fb8b9730f271d71067741b1b2bd444ed713e8806a8a5f039edef20e60c39c5d9a65f44323f97a36e71f99308a3eb7effcc3f5625d9ebda371639"
FIREFOX_ESR_SHA512_arm64="6cac72eeeac6e01c34d2287b4163b8158fe4def24238b21c4e3de8fba2a3366fb6b919623d452b16508205bdcbc544b37ce1e249a98470a8adb1556f9c4eb355"

FIREFOX_RELEASE_VERSION="157.0"
FIREFOX_RELEASE_SHA512_amd64="80bea033c8c7b90d7d2b4a2abe4dff91f65a4548d9f34da5e055413e1d709ba55fc0ded78dc48bbc275c3ecb0417670f7c1ae7cd7ee554bbe066605e6762bd7e"
FIREFOX_RELEASE_SHA512_arm64="0370833d8d5edbe2d90b2e4a3cafd59ca00d8ea15ecef57befd623bab943d55cdd972fa83786dc72935ac370603612cc7929aa128a236ecf8f338cf4be1f0934"

case "$(dpkg --print-architecture)" in
  amd64) arch=amd64; mozilla_arch="linux-x86_64" ;;
  arm64) arch=arm64; mozilla_arch="linux-aarch64" ;;
  *) echo "Unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;;
esac

# GTK is what Firefox links against and the slim base image does not have.
# xz unpacks the tarballs, which have been .tar.xz since Firefox 135, and goes
# again afterwards: nothing else in the image needs it.
export DEBIAN_FRONTEND=noninteractive
# Removed again only if this script is what put it there
xz_was_here=0
dpkg -s xz-utils >/dev/null 2>&1 && xz_was_here=1
apt-get update
apt-get install -y --no-install-recommends libgtk-3-0 xz-utils

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# install_firefox <version> <sha512> <destination>
install_firefox() {
  local version=$1 sha=$2 dest=$3
  curl --fail --silent --show-error --location --retry 3 --output "$work/firefox.tar.xz" \
    "https://archive.mozilla.org/pub/firefox/releases/${version}/${mozilla_arch}/en-US/firefox-${version}.tar.xz"
  echo "$sha  $work/firefox.tar.xz" | sha512sum --check --status \
    || { echo "Checksum mismatch for Firefox $version" >&2; exit 1; }
  mkdir -p "$dest"
  tar -xJf "$work/firefox.tar.xz" -C "$dest"
  rm "$work/firefox.tar.xz"

  # A test browser that phones nobody. The image is read-only at run time, so an
  # update could not land anyway, but the check for one would still go out.
  mkdir -p "$dest/firefox/distribution"
  cat > "$dest/firefox/distribution/policies.json" <<'JSON'
{
  "policies": {
    "DisableAppUpdate": true,
    "DisableTelemetry": true,
    "DisableFirefoxStudies": true,
    "DontCheckDefaultBrowser": true
  }
}
JSON
}

esr_sha="FIREFOX_ESR_SHA512_${arch}"
release_sha="FIREFOX_RELEASE_SHA512_${arch}"
install_firefox "$FIREFOX_ESR_VERSION" "${!esr_sha}" /opt/firefox-esr
install_firefox "$FIREFOX_RELEASE_VERSION" "${!release_sha}" /opt/firefox-release

if [[ $xz_was_here -eq 0 ]]; then
  apt-get purge -y xz-utils
fi
rm -rf /var/lib/apt/lists/*

# Smoke test, so a missing library breaks the build rather than the first run
/opt/firefox-esr/firefox/firefox --version
/opt/firefox-release/firefox/firefox --version
