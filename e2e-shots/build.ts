/**
 * Build the extension for the screenshot run, without touching `extension/`.
 * See scripts/build-copy.ts for why.
 */
import path from 'node:path'
import { buildCopy } from '../scripts/build-copy'

buildCopy(path.resolve(__dirname, '../.tmp/shots/build-src'))
