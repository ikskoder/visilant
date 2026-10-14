/**
 * The terminal side of `just shots`: a running count and nothing else.
 *
 * Playwright's own reporters print every failure in full, which reads as a test
 * suite falling over. A case that could not be drawn is not that here – it is
 * one card in the catalogue that says so – so the terminal only counts.
 */
/* eslint-disable no-console -- a reporter, and printing is all it does */
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import process from 'node:process'

export default class ProgressReporter implements Reporter {
  private total = 0
  private done = 0
  private failed = 0

  onBegin(_config: unknown, suite: Suite) {
    this.total = suite.allTests().length
  }

  onTestEnd(_test: TestCase, result: TestResult) {
    this.done++
    if (!['passed', 'skipped'].includes(result.status))
      this.failed++
    const line = `[shots] ${this.done}/${this.total}${this.failed ? `, ${this.failed} could not be drawn` : ''}`
    if (process.stdout.isTTY)
      process.stdout.write(`\r${line}`)
    else if (this.done === this.total || this.done % 25 === 0)
      console.log(line)
  }

  onEnd(_result: FullResult) {
    if (process.stdout.isTTY)
      process.stdout.write('\n')
  }

  onError(error: { message?: string }) {
    console.error(`[shots] ${error.message ?? error}`)
  }

  printsToStdio() {
    return true
  }
}
