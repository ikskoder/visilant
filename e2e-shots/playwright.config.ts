/**
 * The screenshot run – `just shots`. See e2e-shots/README.md.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.shot.ts',
  // A scenario that fails leaves a hole in the gallery, which is where it is
  // reported. Retrying it would only hide a flaky state from the person looking.
  retries: 0,
  // Three browsers at most, on a laptop somebody is working on
  workers: 3,
  fullyParallel: true,
  timeout: 60000,
  // A quiet count in the terminal. Whatever went wrong with a case is shown on
  // its card in the catalogue, written from the JSON report.
  reporter: [['./progress-reporter.ts'], ['json', { outputFile: '../.tmp/shots/report.json' }]],
  outputDir: '../.tmp/shots/test-results',
  projects: [
    { name: 'light', use: { theme: 'light' } as any },
    { name: 'dark', use: { theme: 'dark' } as any },
    // Firefox for Android draws the same pages in a narrow tab. This is desktop
    // Chromium at phone width, which catches layout that does not fit, and
    // nothing Android does differently.
    { name: 'phone', use: { theme: 'light', pointer: 'touch', shotViewport: { width: 400, height: 800 } } as any },
  ],
})
