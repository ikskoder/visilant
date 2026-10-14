/**
 * The English strings the extension shows, read from the build being shot, so a
 * scenario waits for the text the user will see rather than a copy of it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { EXTENSION_PATH } from './fixtures'

let messages: Record<string, { message: string }> | undefined

export function t(key: string): string {
  messages ??= JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, '_locales/en/messages.json'), 'utf8'))
  const entry = messages![key]
  if (!entry)
    throw new Error(`no message ${key} in the English locale`)
  return entry.message
}
