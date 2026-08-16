# Justfile

# === ALIASES ===
cl: clear
dc: dev-chrome
df: dev-firefox
dfr: dev-firefox-run
bc: build-chrome
bf: build-firefox
ad: android-devices
ar: android-run

# Clear dist and manifest
clear:
  pnpm clear

# === DEVELOPMENT ===

# Dev - Chrome (default)
dev-chrome:
  pnpm dev

# Dev - Firefox
dev-firefox:
  pnpm dev-firefox

# Dev & Launch - Firefox
dev-firefox-run:
  pnpm exec run-p dev-firefox start:firefox:wait

# === BUILD ===

build-chrome:
  pnpm build
  pnpm pack:zip

build-firefox:
  pnpm build-firefox
  pnpm pack:xpi
  pnpm pack:src

# Pack source code for AMO submission (uses git archive — only tracked files)
pack-src:
  pnpm pack:src

# === ANDROID ===
# Needs adb (in the Nix devshell), USB debugging on the phone, and remote
# debugging enabled in Firefox for Android (Settings – About Firefox – tap the
# logo five times). Firefox Nightly is the safest target for temporary installs.

# List Android devices adb can see
android-devices:
  adb devices -l

# web-ext refuses to guess: it wants --android-device even with a single phone
# attached, and --firefox-apk whenever more than one Firefox is installed. Both
# are filled in from adb here. Anything you pass overrides the guess, e.g.
# `just ar --firefox-apk org.mozilla.firefox` to test on release instead.

# Build for Firefox and install on a USB phone as a temporary add-on
android-run *ARGS:
  #!/usr/bin/env bash
  set -euo pipefail
  pnpm build-firefox
  extra="{{ ARGS }}"
  args=()
  adb_target=()

  if [[ "$extra" != *--android-device* ]]; then
    device=$(adb devices | awk '$2 == "device" { print $1 }' | head -n1)
    if [[ -z "$device" ]]; then
      echo "adb sees no ready device. Check the cable, USB debugging, and the authorisation prompt on the phone." >&2
      exit 1
    fi
    echo "Device: $device"
    args+=(--android-device "$device")
    adb_target=(-s "$device")
  fi

  if [[ "$extra" != *--firefox-apk* ]]; then
    packages=$(adb "${adb_target[@]}" shell pm list packages | tr -d '\r')
    # Nightly first: temporary add-ons are the most reliable there
    for apk in org.mozilla.fenix org.mozilla.firefox_beta org.mozilla.firefox; do
      if grep -qx "package:$apk" <<< "$packages"; then
        echo "Firefox: $apk"
        args+=(--firefox-apk "$apk")
        break
      fi
    done
  fi

  pnpm start:firefox-android "${args[@]}" $extra

# === TESTING ===

# Run unit tests
test:
  pnpm test run

# Run unit tests in watch mode
test-watch:
  pnpm test

# Run e2e tests (requires nix develop for Playwright libs)
test-e2e:
  pnpm test:e2e

# Run e2e tests with visible browser
test-e2e-headed:
  npx playwright test --headed

# Install Playwright browsers locally
playwright-install:
  npx playwright install chromium
