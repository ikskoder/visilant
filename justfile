# Justfile

# === ALIASES ===
cl: clear
dc: dev-chrome
df: dev-firefox
dfr: dev-firefox-run
bc: build-chrome
bf: build-firefox

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

build-firefox:
  pnpm build-firefox
  pnpm pack:xpi
