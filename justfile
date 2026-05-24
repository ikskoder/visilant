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

# Pack source code for AMO submission (uses git archive — only tracked files)
pack-src:
  pnpm pack:src

# === TESTING ===

# Run unit tests
test:
  pnpm test run

# Run unit tests in watch mode
test-watch:
  pnpm test

# Run e2e tests (requires nix develop for Playwright libs)
test-e2e:
  pnpm test:e2e

# Run e2e tests with visible browser
test-e2e-headed:
  npx playwright test --headed

# Install Playwright browsers locally
playwright-install:
  npx playwright install chromium
