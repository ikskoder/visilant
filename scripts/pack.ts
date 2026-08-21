// Deterministic packaging: the same `extension/` tree always produces a
// byte-identical archive, so anyone can rebuild a release and compare hashes.
//
// A plain zip is not reproducible – it stores each file's mtime, the order the
// walker happened to return, and the permissions the checkout ended up with.
// All three are pinned here: entries sorted by path, one fixed timestamp
// (`SOURCE_DATE_EPOCH` if set, otherwise the zip epoch), and 0644 for every
// file. Deflate comes from jszip, which is pinned by pnpm-lock.yaml.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import JSZip from 'jszip'
import { log, r } from './utils'

// jszip writes DOS timestamps in local time. Without this the same tree packed
// in two time zones gives two different archives.
process.env.TZ = 'UTC'

// 1980-01-01T00:00:00Z, the oldest moment a zip entry can name.
const ZIP_EPOCH = 315532800

function fixedDate(): Date {
  const raw = process.env.SOURCE_DATE_EPOCH
  const epoch = raw ? Number(raw) : ZIP_EPOCH
  if (!Number.isFinite(epoch) || epoch < ZIP_EPOCH)
    throw new Error(`SOURCE_DATE_EPOCH must be a number >= ${ZIP_EPOCH} (1980-01-01), got: ${raw}`)
  return new Date(epoch * 1000)
}

function walk(dir: string, base = ''): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory())
      files.push(...walk(path.join(dir, entry.name), rel))
    else if (entry.isFile())
      files.push(rel)
  }
  return files
}

export async function pack(sourceDir: string, outFile: string): Promise<void> {
  if (!fs.existsSync(path.join(sourceDir, 'manifest.json')))
    throw new Error(`No manifest.json in ${sourceDir} – run a build first.`)

  const date = fixedDate()
  const zip = new JSZip()

  // Sorted by byte order, not by whatever the file system reports, and with no
  // directory entries at all – one less thing that can differ.
  for (const file of walk(sourceDir).sort()) {
    zip.file(file, fs.readFileSync(path.join(sourceDir, file)), {
      date,
      unixPermissions: 0o644,
      createFolders: false,
    })
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, buffer)
}

async function main() {
  const target = process.argv[2]
  if (target !== 'chrome' && target !== 'firefox') {
    console.error('Usage: esno scripts/pack.ts <chrome|firefox>')
    process.exit(1)
  }

  const pkg = JSON.parse(fs.readFileSync(r('package.json'), 'utf-8')) as { version: string }
  // Chrome wants a zip, AMO an xpi. Both are the same archive under two names.
  const ext = target === 'firefox' ? 'xpi' : 'zip'
  const out = `artifacts/visilant-${pkg.version}-${target}.${ext}`

  await pack(r('extension'), r(out))
  const digest = createHash('sha256').update(fs.readFileSync(r(out))).digest('hex')
  log('PACK', `${out}  sha256:${digest}`)
}

// Only run when invoked directly, so the packer stays importable from tests.
if (process.argv[1] && path.resolve(process.argv[1]).endsWith('pack.ts'))
  main()
