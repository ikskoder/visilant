#!/bin/sh
# Runs on every commit: the linter over what is staged, then the audit over the
# same thing.
#
# The audit is not cached and not skipped when "nothing relevant changed". A
# commit that pastes a key into a file that already existed moves no lockfile
# and touches no dependency, which is exactly the shape of change a cache-keyed
# check waves through.
set -eu

cd "$(git rev-parse --show-toplevel)"

# Everything below needs the project's own toolchain. On this machine that comes
# from the Nix devshell, which direnv normally has loaded already.
run() {
  if command -v pnpm >/dev/null 2>&1 && command -v gitleaks >/dev/null 2>&1; then
    "$@"
  elif [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
    nix develop --command "$@"
  else
    echo "pre-commit: neither the tools nor 'nix develop' are available." >&2
    echo "  Open a shell in the project (direnv, or 'nix develop') and commit from there." >&2
    exit 1
  fi
}

run pnpm lint-staged

# A missing audit script is a failure, not a pass. Exiting 0 here would be
# indistinguishable from a clean scan for anyone reading the commit afterwards.
if [ ! -x scripts/audit.sh ]; then
  echo "pre-commit: scripts/audit.sh is missing or not executable - nothing was audited." >&2
  exit 1
fi

run ./scripts/audit.sh --staged
