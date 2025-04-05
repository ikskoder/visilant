# Justfile

# === ALIASES ===
cl: clear
dc: dev-chrome
df: dev-firefox
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

# === BUILD ===

build-chrome:
  pnpm build

build-firefox:
  pnpm build-firefox
  pnpm pack:xpi
