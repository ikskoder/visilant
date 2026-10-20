#!/usr/bin/env bash
# Runs on the HOST, before Compose reads anything: VS Code calls it as
# initializeCommand, and every `just container-*` recipe calls it first.
#
# It does two things.
#
# 1. Mounts the checkout inside the container at the same absolute path it has
#    on the host, by writing that path to .devcontainer/.env, which Compose
#    reads for the first -f file's directory. Everything that keys state by
#    absolute path then agrees across the two sides: the ESLint cache, paths
#    in error messages and stack traces, and any per-project tool state kept
#    outside the repository. With a fixed /workspaces/visilant in here, all of
#    those went cold or pointed nowhere on every switch.
#
# 2. Creates compose.override.yaml from the example when there is none, so
#    devcontainer.json can list it unconditionally. Compose refuses a missing
#    -f file, and the example adds nothing.
#
# The path is the physical one (`pwd -P`), because that is what getcwd()
# returns inside the container and what any tool records. A checkout opened
# through a symlink would otherwise be mounted under one name and report
# itself under another, so that case is refused rather than half-working.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
root=$(cd "$here/.." && pwd -P)

# VS Code passes the folder it opened. It has to be the same directory under
# the same name, because devcontainer.json opens ${localWorkspaceFolder}
# inside the container and that is where the mount has to be.
if [[ $# -gt 0 && "$1" != "$root" ]]; then
  echo "workspace-env: VS Code opened '$1', which resolves to '$root'." >&2
  echo "  Open the real path instead of the symlink, so that both name one directory." >&2
  exit 1
fi

# Somewhere the image or a volume already owns would be hidden by the bind, or
# would hide it. A path Docker cannot take as a mount target at all (Windows,
# a quote that .env cannot carry) fails here with a reason rather than inside
# Compose without one.
case "$root" in
  /root|/root/*|/opt|/opt/*|/usr|/usr/*|/etc|/etc/*|/bin|/bin/*|/sbin|/sbin/*|/lib|/lib/*|/lib64|/lib64/*|/tmp|/tmp/*|/var/tmp|/var/tmp/*|/run|/run/*|/proc|/proc/*|/sys|/sys/*|/dev|/dev/*|/boot|/boot/*)
    echo "workspace-env: the checkout is at '$root', which the container already uses." >&2
    echo "  Move it under your home directory or another data directory." >&2
    exit 1 ;;
  /*) ;;
  *)
    echo "workspace-env: '$root' is not an absolute Unix path." >&2
    exit 1 ;;
esac
if [[ "$root" == *"'"* || "$root" == *$'\n'* ]]; then
  echo "workspace-env: '$root' contains a quote or a newline, which .env cannot carry." >&2
  exit 1
fi

# Single quotes, so a space or a # in the path is kept literally.
line="VISILANT_WORKSPACE='$root'"
env_file="$here/.env"
if [[ ! -f "$env_file" ]] || [[ "$(cat "$env_file")" != "$line" ]]; then
  printf '%s\n' "$line" > "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
fi

if [[ ! -e "$here/compose.override.yaml" ]]; then
  cp "$here/compose.override.yaml.example" "$here/compose.override.yaml"
fi
