#!/bin/sh
# Rejects a commit message longer than 1000 characters. The subject says what
# changed, the body says why in a few short paragraphs, and anything longer
# belongs in the code comments or the docs, where it stays next to what it
# describes.
#
# Git hands this hook the message before its own cleanup, so the comment lines
# and everything below the scissors line of `commit --verbose` are dropped here
# first, leaving only what will end up in the commit.
set -eu

LIMIT=1000

msg=$(sed '/^# -\{24\} >8 -\{24\}$/,$d' "$1" | git stripspace --strip-comments)

# Characters, not bytes: an en dash is three bytes in UTF-8. Counting only the
# bytes that start a character works the same under any locale, including the
# POSIX one the devcontainer runs with, where `wc -m` counts bytes.
count=$(printf '%s' "$msg" | LC_ALL=C tr -d '\200-\277' | wc -c)

if [ "$count" -gt "$LIMIT" ]; then
  echo "commit-msg: the message is $count characters long, the limit is $LIMIT." >&2
  echo "  Shorten the body. Details that matter later belong in code comments or docs." >&2
  exit 1
fi
