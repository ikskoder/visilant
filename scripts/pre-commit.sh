#!/bin/sh

if command -v pnpm >/dev/null 2>&1; then
    pnpm lint-staged
elif [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
    nix develop --command pnpm lint-staged
else
    echo "Error: pnpm not found and cannot use nix develop"
    exit 1
fi
