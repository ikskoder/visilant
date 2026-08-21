#!/usr/bin/env bash
# Compare an extension package downloaded from a store with a build made from
# this source tree.
#
# The two archives can never match byte for byte – AMO wraps the xpi in its own
# signature (META-INF/) and Chrome re-packs the zip inside a signed CRX
# container – so the comparison is done file by file on the contents.
#
# Usage:
#   scripts/verify.sh path/to/downloaded.xpi
#   scripts/verify.sh --target chrome path/to/downloaded.crx
#   scripts/verify.sh --built result path/to/downloaded.xpi
set -euo pipefail

target=""
built=""
package=""

while [ $# -gt 0 ]; do
  case "$1" in
    --target) target="$2"; shift 2 ;;
    --built) built="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) package="$1"; shift ;;
  esac
done

[ -n "$package" ] || { echo "Usage: scripts/verify.sh [--target firefox|chrome] [--built DIR] <package>" >&2; exit 2; }
[ -f "$package" ] || { echo "No such file: $package" >&2; exit 2; }

if [ -z "$target" ]; then
  case "$package" in
    *.xpi) target=firefox ;;
    *.crx|*.zip) target=chrome ;;
    *) echo "Cannot tell the target from $package – pass --target." >&2; exit 2 ;;
  esac
fi

for tool in unzip sha256sum; do
  command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 2; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The reference build. Nix is what the published hashes come from, so it is the
# default – but a directory built by hand works just as well.
if [ -z "$built" ]; then
  command -v nix >/dev/null || { echo "nix is required, or pass --built with a built extension/ directory." >&2; exit 2; }
  echo "Building .#$target – this takes a few minutes the first time."
  nix build ".#$target" --out-link "$work/result" --print-build-logs
  built="$work/result"
fi

if [ -d "$built/unpacked" ]; then
  reference="$built/unpacked"
elif [ -f "$built/manifest.json" ]; then
  reference="$built"
else
  echo "--built should point at a Nix result or at an extension/ directory." >&2
  exit 2
fi

# unzip reads a CRX happily: it scans for the central directory and ignores the
# signature header Chrome puts in front of it.
mkdir -p "$work/downloaded"
unzip -qq -o "$package" -d "$work/downloaded"

hash_tree() {
  ( cd "$1" && find . -type f | LC_ALL=C sort | xargs -r sha256sum ) \
    | sed 's|  \./|  |'
}

hash_tree "$reference" > "$work/reference.txt"
hash_tree "$work/downloaded" > "$work/downloaded.txt"

# What the stores add on their way out. Nothing here is built from source, so
# nothing here can be reproduced.
is_store_added() {
  case "$1" in
    META-INF/*|mozilla-recommendation.json|_metadata/*) return 0 ;;
    *) return 1 ;;
  esac
}

status=0
differing=()
missing=()
extra=()
matched=0

while read -r sum file; do
  other=$(awk -v f="$file" '$2 == f { print $1 }' "$work/downloaded.txt")
  if [ -z "$other" ]; then
    missing+=("$file")
  elif [ "$other" = "$sum" ]; then
    matched=$((matched + 1))
  else
    differing+=("$file")
  fi
done < "$work/reference.txt"

while read -r _ file; do
  grep -q "  $file\$" "$work/reference.txt" && continue
  if is_store_added "$file"; then
    extra+=("$file (added by the store)")
  else
    extra+=("$file")
    status=1
  fi
done < "$work/downloaded.txt"

echo
echo "Reference: $reference"
echo "Package:   $package"
echo
echo "$matched file(s) identical"

if [ ${#differing[@]} -gt 0 ]; then
  status=1
  echo
  echo "Differing:"
  printf '  %s\n' "${differing[@]}"
  # A manifest that differs is worth showing – the store may rewrite a field.
  if printf '%s\n' "${differing[@]}" | grep -qx manifest.json && command -v diff >/dev/null; then
    echo
    echo "manifest.json diff (reference -> package):"
    diff -u "$reference/manifest.json" "$work/downloaded/manifest.json" | sed 's/^/  /' || true
  fi
fi

if [ ${#missing[@]} -gt 0 ]; then
  status=1
  echo
  echo "Missing from the package:"
  printf '  %s\n' "${missing[@]}"
fi

if [ ${#extra[@]} -gt 0 ]; then
  echo
  echo "Only in the package:"
  printf '  %s\n' "${extra[@]}"
fi

echo
if [ "$status" -eq 0 ]; then
  echo "MATCH – every file in the package was built from this source."
else
  echo "MISMATCH – see the lists above."
fi
exit "$status"
