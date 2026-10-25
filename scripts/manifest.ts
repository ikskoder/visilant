import fs from 'fs-extra'
import { getManifest } from '../src/manifest'
import { log, out } from './utils'

export async function writeManifest() {
  await fs.writeJSON(out('manifest.json'), await getManifest(), { spaces: 2 })
  log('PRE', 'write manifest.json')
}

writeManifest()
