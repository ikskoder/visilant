#!/usr/bin/env bash
# Asserted on every container start, because every one of these has failed
# quietly somewhere before.
#
# Two classes of check, and the difference matters:
#   - a hard failure for anything with an action attached (a tool that is not in
#     the image, a version that has drifted from what the project asks for), and
#     the message names the action,
#   - a loud warning for anything the person reading it cannot fix from in here.
#     A guard that fails a start with no available remedy locks them out of the
#     container, which is worse than the condition it was reporting.
set -uo pipefail

# Lifecycle commands do not arrive with a dependable PATH: the Dev Containers
# extension probes the remote user's shell, and a login shell that resets PATH
# before /etc/profile.d runs leaves everything installed here off it entirely.
PATH="/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH

fail() { echo "  FAIL  $*" >&2; failed=1; }
warn() { echo "  WARN  $*" >&2; }
ok()   { echo "  ok    $*"; }
failed=0

echo "Visilant dev container"

# ── 1. Are we even in here ───────────────────────────────────────────────────
if [[ ! -e /.dockerenv && -z "${REMOTE_CONTAINERS:-}" && -z "${CODESPACES:-}" ]]; then
  echo "This check must run inside the dev container." >&2
  exit 1
fi

# ── 2. Which daemon, because `user: root` means opposite things on the two ───
# Under rootless docker container-root is your host account. Under a rootful one
# it is host root, and compose.yaml then has the wrong user.
if [[ -r /proc/self/uid_map ]]; then
  # rootlesskit maps host uid 0 to something other than 0 for the container's
  # view, and a rootful daemon maps 0 to 0.
  host_uid=$(awk 'NR==1 {print $2}' /proc/self/uid_map)
  if [[ "$host_uid" == "0" ]]; then
    warn "this looks like a ROOTFUL docker daemon. compose.yaml assumes rootless"
    warn "and runs as root, which writes root-owned files into your tree."
    warn "Change 'user: root' to 'user: node' in .devcontainer/compose.yaml."
  else
    ok "rootless daemon (container root maps to host uid $host_uid)"
  fi
fi

# ── 3. Every tool, saying which of the two problems it is ────────────────────
# "Not installed" and "installed but off PATH" read identically until you go
# looking, and the second is the one a shell-startup change causes.
for tool in node pnpm just git gitleaks jq unzip; do
  command -v "$tool" >/dev/null && continue
  found=""
  for dir in /usr/local/bin /root/.local/share/pnpm /usr/bin /bin; do
    [[ -x "$dir/$tool" ]] && { found="$dir/$tool"; break; }
  done
  if [[ -n "$found" ]]; then
    fail "'$tool' exists at $found but is not on PATH ($PATH)"
  else
    fail "'$tool' is not installed in this image - check .devcontainer/Dockerfile"
  fi
done
[[ $failed -eq 0 ]] && ok "tools: node pnpm just git gitleaks jq unzip"

# ── 4. The versions this image was built for are the ones the project wants ──
# The image bakes Node, pnpm and Chromium. flake.lock decides the first two for
# the Nix release build and pnpm-lock.yaml decides the third, and none of those
# files can reach into a built image. Without this check the two drift apart and
# the container quietly tests something the release is not.
if [[ -f package.json ]]; then
  # `engines.node` is a range, and only a range of exactly one version can be
  # compared like this. ">=22.21.1" is the shape this project uses and it names
  # a single version, but "^22.21.1" or ">=22" do not - and comparing those as
  # if they were exact would fail every start with advice that makes it worse.
  want_node=$(node -p "(require('./package.json').engines?.node ?? '').replace(/^[^0-9]*/,'')" 2>/dev/null)
  have_node=$(node -p "process.versions.node" 2>/dev/null)
  if [[ -n "$want_node" && ! "$want_node" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    warn "package.json asks for node '$(node -p "require('./package.json').engines?.node" 2>/dev/null)',"
    warn "  which names more than one version, so the image cannot be checked against it."
    warn "  The image has $have_node. Pin engines.node to one version to get this check back."
    want_node=""
  fi
  if [[ -n "$want_node" && "$want_node" != "$have_node" ]]; then
    fail "Node $have_node in the image, package.json asks for $want_node."
    fail "  Bump BASE_IMAGE in .devcontainer/compose.yaml to node:$want_node-bookworm-slim"
    fail "  (with its digest), then rebuild the container."
  fi

  want_pnpm=$(node -p "(require('./package.json').packageManager ?? '').split('@')[1] ?? ''" 2>/dev/null)
  have_pnpm=$(pnpm --version 2>/dev/null)
  if [[ -n "$want_pnpm" && "$want_pnpm" != "$have_pnpm" ]]; then
    fail "pnpm $have_pnpm in the image, package.json asks for $want_pnpm."
    fail "  Update .devcontainer/node-tools/package.json and its lock, then rebuild."
  fi
  # Say which of the two was actually compared. "as package.json asks" over a
  # comparison that was skipped is the same sort of overclaim this file exists
  # to stop.
  if [[ $failed -eq 0 ]]; then
    if [[ -n "$want_node" ]]; then
      ok "node $have_node, pnpm $have_pnpm (both as package.json asks)"
    else
      ok "node $have_node (not checked, see above), pnpm $have_pnpm (as package.json asks)"
    fi
  fi
fi

# ── 5. Chromium, which cannot be fetched at run time ─────────────────────────
# PLAYWRIGHT_BROWSERS_PATH is on the read-only root filesystem, so a Playwright
# that wants a different build tries to download it and fails with a permissions
# error that says nothing about the real cause.
if [[ -f pnpm-lock.yaml ]]; then
  want_pw=$(grep -oE "^  playwright@[0-9]+\.[0-9]+\.[0-9]+:" pnpm-lock.yaml | head -1 | tr -d ' :' | cut -d@ -f2)
  have_pw=$(node -p "require('/opt/visilant-node-tools/node_modules/playwright/package.json').version" 2>/dev/null)
  # Neither of these may be quietly empty. The first version of this check fell
  # through to "ok chromium seeded by playwright X" when the lockfile grep found
  # nothing, so a change of lockfile format would have switched the comparison
  # off and still printed a tick.
  if [[ -z "$want_pw" ]]; then
    fail "could not read a playwright version out of pnpm-lock.yaml."
    fail "  The lockfile format has probably changed, and the check that the image's"
    fail "  Chromium matches the project is therefore not running at all."
  elif [[ -z "$have_pw" ]]; then
    fail "no playwright under /opt/visilant-node-tools - the image is not what it should be."
    fail "  Rebuild with 'just container-build'."
  elif [[ "$want_pw" != "$have_pw" ]]; then
    fail "Chromium was seeded by Playwright $have_pw, pnpm-lock.yaml resolves $want_pw."
    fail "  Set playwright to $want_pw in .devcontainer/node-tools/package.json,"
    fail "  refresh its package-lock.json, then rebuild the container."
  else
    browser=$(find "${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}" -maxdepth 1 -name 'chromium-*' 2>/dev/null | head -1)
    if [[ -z "$browser" ]]; then
      fail "no Chromium under ${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright} - the image build did not seed it."
    else
      ok "chromium seeded by playwright $have_pw ($(basename "$browser"))"
    fi
  fi
fi

# ── 6. The things a read-only root filesystem breaks ─────────────────────────
# `test -w` on a path that does not exist is false for the wrong reason, so
# create first and then ask.
for dir in "$HOME" "${PNPM_HOME:-$HOME/.local/share/pnpm}" "$HOME/.npm"; do
  mkdir -p "$dir" 2>/dev/null || true
  if [[ ! -w "$dir" ]]; then
    fail "$dir is not writable - pnpm and npm cannot cache anything there."
  fi
done

# And in the shell a person actually types into, which reads different files
# from the one running this script.
for shell_bin in bash sh; do
  command -v "$shell_bin" >/dev/null || continue
  probe=$(env -i HOME=/root TERM=dumb "$shell_bin" -lc 'command -v pnpm' 2>/dev/null)
  [[ -n "$probe" ]] || warn "an interactive $shell_bin does not find pnpm on PATH"
done

# ── 7. Is there anything to run ──────────────────────────────────────────────
# The container's node_modules is its own volume and starts empty, so a fresh
# container prints a clean bill of health over a tree where `pnpm lint` answers
# "eslint: not found". A warning rather than a failure, because this is the
# normal state on the very first start and postCreateCommand installs right
# after this runs.
if [[ -f package.json ]]; then
  if [[ ! -d node_modules || -z "$(ls -A node_modules 2>/dev/null)" ]]; then
    warn "node_modules is empty. Nothing will run until you do:"
    warn "    pnpm install --frozen-lockfile"
    warn "  (the container has its own node_modules on a volume, separate from the"
    warn "   host's - see .devcontainer/README.md)"
  else
    ok "node_modules present"
  fi
fi

# ── 8. Did the hardening actually take effect ────────────────────────────────
# Nothing in here can fix these, so they warn rather than fail. Read /proc/1,
# not /proc/self: `docker exec` is a different process and can mislead you.
caps=$(awk '/^CapBnd/{print $2}' /proc/1/status 2>/dev/null)
if [[ "$caps" == "0000000000000000" ]]; then
  ok "capabilities: none (cap_drop ALL took effect)"
else
  warn "capabilities $caps despite cap_drop ALL. Something re-added them - most"
  warn "likely a Dev Container Feature's metadata merged into a generated compose"
  warn "override. See the comment at the top of .devcontainer/Dockerfile."
fi

seccomp=$(awk '/^Seccomp:/{print $2}' /proc/1/status 2>/dev/null)
if [[ "$seccomp" == "2" ]]; then
  ok "seccomp filter active"
else
  warn "no seccomp filter (Seccomp=$seccomp, expected 2). The default profile"
  warn "blocks about forty syscalls, and without it that is kernel attack surface."
fi

if touch /probe-readonly 2>/dev/null; then
  rm -f /probe-readonly
  warn "the root filesystem is writable - 'read_only: true' did not take effect."
else
  ok "root filesystem read-only"
fi

echo
if [[ $failed -ne 0 ]]; then
  echo "The container is not usable as it stands - see FAIL above." >&2
  exit 1
fi

echo "Ready. 'just --list' for the recipes, 'just audit' before a dependency bump."
echo "On the host, not in here: 'just nf' / 'just nc' / 'just nk' (the Nix release"
echo "build needs user namespaces that this container deliberately cannot have),"
echo "and 'just ar', which needs the phone's USB device."
