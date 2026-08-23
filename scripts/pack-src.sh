#!/usr/bin/env bash
# Pack the source for an AMO submission.
#
# `git archive` writes what is committed, and the extension is built from what is
# on disk. On a clean tree those are the same thing. On a dirty one they are not,
# and the two artifacts then describe different code - which is precisely the
# claim a source archive exists to support.
#
# So: refuse a dirty tracked tree rather than quietly pack the wrong thing.
# Untracked files are left alone, because `git archive` never includes them and
# neither does the Nix build.
set -euo pipefail

ref="${1:-HEAD}"

dirty=$(git status --porcelain --untracked-files=no)
if [ -n "$dirty" ]; then
  echo "The tracked files have uncommitted changes:" >&2
  echo "$dirty" >&2
  echo >&2
  echo "The source archive would not describe the extension built from this tree." >&2
  echo "Commit or stash first." >&2
  exit 1
fi

rm -f source.zip
git archive --format=zip --output=source.zip "$ref"
echo "source.zip written from $(git rev-parse --short "$ref")"
