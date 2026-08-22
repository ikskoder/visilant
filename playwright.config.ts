/**
 * @see {@link https://playwright.dev/docs/chrome-extensions Chrome extensions | Playwright}
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  retries: 2,
  /**
   * Sixty seconds, not thirty.
   *
   * These tests drive a real browser with a real extension in it: an install
   * runs, a service worker starts and is stopped again, a history import reads
   * to the end. On a developer's machine that fits inside thirty seconds and on
   * a CI runner with two workers on shared cores it does not, and the failure
   * arrives as a page closed underneath a click rather than as anything about
   * the extension. The limit is here to stop a hang, not to time the work.
   */
  timeout: 60000,
})
