# Justfile

# === ALIASES ===
# Real aliases rather than recipes that call the long one, so arguments reach
# it: `just ss -g popup` is `just shots -g popup`.
alias cl := clear
alias dc := dev-chrome
alias df := dev-firefox
alias dfr := dev-firefox-run
alias bc := build-chrome
alias bf := build-firefox
alias ad := android-devices
alias ar := android-run
alias ae := android-e2e
alias fe := firefox-e2e
alias ss := shots
alias sw := shots-watch
alias nf := nix-firefox
alias nc := nix-chrome
alias nk := nix-check
alias cb := container-build
alias cu := container-up
alias cs := container-shell
alias ck := container-check
alias au := audit
alias rl := release

# Clear both builds: extension/ (Chrome) and extension-firefox/ (Firefox)
clear:
  pnpm clear
  pnpm clear-firefox

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

# Pack source code for AMO submission (uses git archive – only tracked files)
pack-src:
  pnpm pack:src

# === REPRODUCIBLE BUILDS ===
# The Nix build is the one releases are cut from. It pins node, pnpm and every
# dependency through flake.lock, so the same commit gives the same bytes on any
# machine. See REPRODUCE.md.

# Reproducible build for Firefox, with hashes
nix-firefox:
  nix build .#firefox --print-build-logs
  cat result/SHA256SUMS

# Reproducible build for Chrome, with hashes
nix-chrome:
  nix build .#chrome --out-link result-chrome --print-build-logs
  cat result-chrome/SHA256SUMS

# Build both targets a second time and fail if a single byte differs
nix-check:
  nix build .#firefox --print-build-logs
  nix build .#firefox --rebuild --print-build-logs
  nix build .#chrome --out-link result-chrome --print-build-logs
  nix build .#chrome --rebuild --out-link result-chrome --print-build-logs
  @echo "Both targets rebuilt identically."

# Compare a package downloaded from a store with a build from this tree
verify PACKAGE:
  ./scripts/verify.sh {{ PACKAGE }}

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
[positional-arguments]
android-run *ARGS:
  #!/usr/bin/env bash
  set -euo pipefail
  pnpm build-firefox
  extra=("$@")
  args=()
  adb_target=()

  if [[ " ${extra[*]} " != *" --android-device"* ]]; then
    device=$(adb devices | awk '$2 == "device" { print $1 }' | head -n1)
    if [[ -z "$device" ]]; then
      echo "adb sees no ready device. Check the cable, USB debugging, and the authorisation prompt on the phone." >&2
      exit 1
    fi
    echo "Device: $device"
    args+=(--android-device "$device")
    adb_target=(-s "$device")
  fi

  if [[ " ${extra[*]} " != *" --firefox-apk"* ]]; then
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

  pnpm start:firefox-android "${args[@]}" "${extra[@]}"

# Build for Firefox, install on the phone, then run the Android e2e tests.
# `just ar` has to be running in another shell for the install to stay put – it
# is a temporary add-on, and it goes when web-ext lets go.
[positional-arguments]
android-e2e *ARGS:
  pnpm build-firefox
  pnpm test:android "$@"

# === TESTING ===

# FIREFOX names the browser binary, 140 or later, and FIREFOX_MIN a second one
# to run the same tests on, if set. The dev container sets both: the current
# release and ESR 140. Pass part of a test name to run only that, and
# SHOTS=<dir> to keep a screenshot of every warning.

# extension/ is left alone: it is what your own browser loads, and rebuilding it
# under a running browser breaks the extension there.
# Build a Firefox copy under .tmp/e2e-firefox, then run the Firefox e2e tests on it
[positional-arguments]
firefox-e2e *ARGS:
  @test -x "${FIREFOX:-}" || { echo 'Set FIREFOX to a Firefox binary, 140 or later, e.g. FIREFOX=$(command -v firefox) just fe' >&2; exit 1; }
  pnpm exec esno scripts/build-copy.ts .tmp/e2e-firefox firefox
  VISILANT_EXTENSION=.tmp/e2e-firefox/extension-firefox pnpm test:firefox "$@"
  if [ -n "${FIREFOX_MIN:-}" ]; then FIREFOX="$FIREFOX_MIN" VISILANT_EXTENSION=.tmp/e2e-firefox/extension-firefox pnpm test:firefox "$@"; fi

# === SCREENSHOTS ===
# Every case the extension can draw, made up on purpose, for a person to look
# through: most of them never come up in ordinary browsing. Each is drawn in
# light, dark and at phone width into .tmp/shots/index.html, a catalogue with a
# note per case. Nothing is compared or asserted. Built from a copy of the tree
# under .tmp, so extension/ and a running `pnpm dev` are left alone. Extra args
# go to Playwright, e.g. `just shots -g popup` or `just shots -g 'long|idn'`,
# and redraw only the matching cards, keeping the rest of the catalogue.
# They reach it as typed: `[positional-arguments]` hands them over as "$@"
# rather than pasting them into the shell line, where a `|` became a pipe and
# a space split a pattern in two. See e2e-shots/README.md.

# Build, draw every case, write the catalogue
[positional-arguments]
shots *ARGS:
  pnpm exec esno e2e-shots/run.ts "$@"

# Draw them again after every change to the sources
[positional-arguments]
shots-watch *ARGS:
  pnpm exec esno e2e-shots/watch.ts "$@"

# Put the catalogue as it is now aside, to compare a later run with
shots-keep:
  rm -rf .tmp/shots/before
  cp -r .tmp/shots/run .tmp/shots/before

# A few dozen pictures in place of the whole catalogue: each block (an address
# with its verdict, a short link, the comparison table…) in each of its states,
# one column per surface that draws it, cut from the last `just shots`:
# .tmp/shots/patterns.html
patterns:
  pnpm exec esno e2e-shots/patterns.ts

# What changed since `just shots-keep`, case by case and close up: .tmp/shots/compare/index.html
[positional-arguments]
shots-diff *ARGS:
  pnpm exec esno e2e-shots/compare.ts "$@"

# Run unit tests
test:
  pnpm test run

# Run unit tests in watch mode
test-watch:
  pnpm test

# Run e2e tests on whatever is in extension/ (requires nix develop for Playwright libs)
test-e2e:
  pnpm test:e2e

# Leaves extension/ alone. Extra args go to Playwright, e.g. `just e2e --workers=3`
# Build a Chrome copy under .tmp/e2e-chrome, then run the Chromium e2e tests on it
[positional-arguments]
e2e *ARGS:
  pnpm exec esno scripts/build-copy.ts .tmp/e2e-chrome chrome
  VISILANT_EXTENSION=.tmp/e2e-chrome/extension pnpm exec playwright test "$@"

# Run e2e tests with visible browser
test-e2e-headed:
  npx playwright test --headed

# Install Playwright browsers locally
playwright-install:
  npx playwright install chromium

# === AUDIT ===
# Secrets, machine-specific paths, and dependency advisories. Run it before a
# dependency bump. The pre-commit hook runs the --staged form on every commit.

# Audit the whole repository
audit:
  ./scripts/audit.sh

# Audit only what is staged, the way the pre-commit hook does
audit-staged:
  ./scripts/audit.sh --staged

# === RELEASE ===

# One atomic push, so by the time the branch run starts the tag is there and
# the branch run leaves the build to the tag run (the `gate` job in build.yml).
# Pushed apart, the same commit was built twice.

# Tag the version package.json names and push main with it: `just release 4.0.1`
release VERSION:
  #!/usr/bin/env bash
  set -euo pipefail
  version="{{ VERSION }}"
  version="${version#v}"
  tag="v$version"
  in_package=$(node -p 'require("./package.json").version')
  if [[ "$in_package" != "$version" ]]; then
    echo "package.json says $in_package, not $version. Bump it and commit first." >&2
    exit 1
  fi
  if [[ "$(git branch --show-current)" != main ]]; then
    echo "Releases are tagged on main." >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Tracked files have changes that the tag would not include. Commit them first." >&2
    exit 1
  fi
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || [[ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]]; then
    echo "$tag already exists." >&2
    exit 1
  fi
  git tag -a "$tag" -m "$version"
  git push --atomic origin main "$tag"
  echo "Pushed main and $tag. The release is published by the tag run of the build workflow."

# === DEV CONTAINER ===
# Where install, build, lint, tests and the e2e suite belong: they run a
# thousand packages of other people's code, and in here that code cannot see
# your home directory. See .devcontainer/README.md for what deliberately stays
# on the host - the Nix release build and anything involving the phone.

# Compose needs the checkout's path in .devcontainer/.env, the same file VS
# Code writes through initializeCommand. See the script for why.
_container-env:
  @bash .devcontainer/scripts/workspace-env.sh

# Build the container image
container-build: _container-env
  cd .devcontainer && docker compose build workspace

# Start the container in the background
container-up: _container-env
  cd .devcontainer && docker compose up -d workspace

# Stop it, keeping the volumes
container-down: _container-env
  cd .devcontainer && docker compose down

# A shell inside it
container-shell: _container-env
  cd .devcontainer && docker compose exec workspace bash -l

# Re-run the start-up checks and print what the hardening actually did
container-check: _container-env
  cd .devcontainer && docker compose exec workspace bash .devcontainer/scripts/check-workspace.sh

# Run a command inside the container, e.g. `just c pnpm test run`
#
# The words reach docker as typed, one argument each, and no shell reads them
# on the host. So a pipe or a redirect is not one either: write
# `just c bash -c 'pnpm lint | tail'`, or use `just container-shell`.
# compose.yaml already sets working_dir, so no `cd` is needed, and PATH comes
# from the image so pnpm, just and gitleaks are all found.
[positional-arguments]
c +ARGS: _container-env
  cd .devcontainer && docker compose exec workspace "$@"
