/**
 * The toolbar button: which icon and which badge a site gets.
 *
 * The browser's own toolbar is not part of any screenshot an automation tool can
 * take, so this one is put together: the worker's calls to draw the button are
 * recorded as it makes them, and the icon file and badge it asked for are laid
 * out on a page of their own. Nothing in it is a guess about what the code
 * should draw – only what it did.
 */
import type { BrowserContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { EXTENSION_PATH, FAMILIAR, inWorker, openSite, patchSettings, patchWorker, seed, sitePage, test } from './fixtures'

// Evaluated inside the extension's service worker
declare const chrome: any

interface Drawn { badge: string, color: number[] | string | null, icon: string | null }

/** Record every icon the worker sets, by tab. */
async function recordIcons(context: BrowserContext) {
  await patchWorker(context, () => {
    const g = globalThis as any
    const api = g.chrome.action
    const original = api.setIcon
    g.__shotsIcons = {}
    api.setIcon = (details: any, ...rest: any[]) => {
      const sizes = typeof details.path === 'string' ? { 0: details.path } : details.path ?? {}
      const largest = Object.keys(sizes).sort((a, b) => Number(b) - Number(a))[0]
      g.__shotsIcons[details.tabId ?? 'all'] = largest ? sizes[largest] : null
      return original.call(api, details, ...rest)
    }
    return () => {
      api.setIcon = original
      delete g.__shotsIcons
    }
  })
}

async function drawnFor(context: BrowserContext, url: string): Promise<Drawn> {
  return inWorker(context, async (pattern: string) => {
    const [tab] = await chrome.tabs.query({ url: pattern })
    const g = globalThis as any
    return {
      badge: await chrome.action.getBadgeText({ tabId: tab.id }),
      color: await chrome.action.getBadgeBackgroundColor({ tabId: tab.id }),
      icon: g.__shotsIcons?.[tab.id] ?? g.__shotsIcons?.all ?? null,
    }
  }, `${new URL(url).origin}/*`)
}

function iconDataUrl(icon: string | null) {
  if (!icon)
    return ''
  // Recorded as a full extension URL or as a path inside the package
  const file = path.join(EXTENSION_PATH, icon.replace(/^chrome-extension:\/\/[^/]+/, '').replace(/^\//, ''))
  return fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : ''
}

const CASES = [
  { url: 'https://unknown-shop.test/', label: 'Unfamiliar site' },
  { url: 'https://my-bank.test/', label: 'Familiar site' },
  { url: 'https://noisy-forum.test/', label: 'Warnings turned off' },
  { url: 'https://tamper-poc.test/', label: 'Page removed the extension (tampering)' },
]

test('toolbar button in every look', async ({ context, theme, shot }) => {
  await seed(context, { 'my-bank.test': FAMILIAR, 'noisy-forum.test': { visits: 3, ignored: true } })
  await patchSettings(context, { changeIcon: true })
  await recordIcons(context)

  const rows: string[] = []
  for (const c of CASES) {
    const page = await context.newPage()
    const tamper = c.url.includes('tamper')
      ? `<script>setTimeout(() => { for (const el of document.body.children) if (el.style && el.style.zIndex === '2147483647') el.remove() }, 2500)</script>`
      : ''
    await openSite(page, c.url, sitePage(c.label, `<p>${c.label}</p>${tamper}`))
    if (tamper)
      await page.waitForTimeout(2500)
    const drawn = await drawnFor(context, c.url)
    const color = Array.isArray(drawn.color) ? `rgba(${drawn.color.slice(0, 3).join(',')},${(drawn.color[3] ?? 255) / 255})` : (drawn.color ?? 'transparent')
    rows.push(`<div class="row">
      <div class="button"><img src="${iconDataUrl(drawn.icon)}" alt="">${drawn.badge ? `<span class="badge" style="background:${color}">${drawn.badge}</span>` : ''}</div>
      <div><b>${c.label}</b><br><code>${new URL(c.url).hostname}</code><br><small>${drawn.icon ?? 'no icon set'} · badge "${drawn.badge}" · ${color}</small></div>
    </div>`)
    await page.close()
  }

  const dark = theme === 'dark'
  const sheet = await context.newPage()
  await sheet.setContent(`<style>
    body { margin: 0; padding: 24px; font: 14px sans-serif; background: ${dark ? '#202124' : '#f1f3f4'}; color: ${dark ? '#e8eaed' : '#202124'} }
    .row { display: flex; gap: 20px; align-items: center; margin-bottom: 18px }
    .button { position: relative; width: 64px; height: 64px; flex: none; background: ${dark ? '#35363a' : '#fff'}; border-radius: 12px; display: flex; align-items: center; justify-content: center }
    .button img { width: 40px; height: 40px }
    .badge { position: absolute; right: -4px; bottom: -2px; color: #fff; font: bold 12px sans-serif; padding: 1px 4px; border-radius: 4px }
    small { opacity: .7 }
    #sheet { display: inline-block; padding: 8px }
  </style><div id="sheet">${rows.join('')}</div>`)
  await shot(sheet, { name: 'toolbar', title: 'Toolbar button: icon and badge per kind of site, as the worker drew them', covers: ['src/logic/badge.ts'] }, { clip: '#sheet' })
})
