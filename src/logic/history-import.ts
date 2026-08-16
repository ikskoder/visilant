import type { SiteVisitData } from './storage'
import { dayKey, isTrackableHostname } from './visit-stats'

export interface ImportedDomainStats {
  count: number
  lastSeen: number
  firstSeen?: number
  activeDays?: number
}

/**
 * Hostname of a browser-history entry, or null if the entry is not a web page we
 * track (non-http schemes, localhost and other dotless names, unparseable URLs).
 */
export function hostnameFromHistoryUrl(url: string | undefined): string | null {
  if (!url)
    return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null

    const hostname = parsed.hostname.toLowerCase()
    return isTrackableHostname(hostname) ? hostname : null
  }
  catch {
    return null
  }
}

/** Fold one URL's individual visit timestamps into the running stats of its hostname. */
export function addVisitTimes(
  stats: ImportedDomainStats | undefined,
  times: number[],
  days: Set<string>,
): ImportedDomainStats | undefined {
  const valid = times.filter(time => typeof time === 'number' && Number.isFinite(time) && time > 0)
  if (!valid.length)
    return stats

  for (const time of valid)
    days.add(dayKey(time))

  const first = Math.min(...valid)
  const last = Math.max(...valid)

  if (!stats)
    return { count: valid.length, firstSeen: first, lastSeen: last }

  return {
    count: stats.count + valid.length,
    firstSeen: Math.min(stats.firstSeen ?? first, first),
    lastSeen: Math.max(stats.lastSeen, last),
  }
}

/**
 * Merge imported history stats into an existing record.
 *
 * Deliberately idempotent – every field folds by min/max rather than by addition,
 * so importing twice cannot inflate the counters. `ignored` is user intent and is
 * never touched by an import.
 */
export function mergeImportedStats(
  existing: SiteVisitData | undefined,
  imported: ImportedDomainStats,
): SiteVisitData {
  const merged: SiteVisitData = {
    count: Math.max(existing?.count || 0, imported.count),
    lastSeen: Math.max(existing?.lastSeen || 0, imported.lastSeen),
    ignored: existing?.ignored || false,
  }

  const firstSeen = [existing?.firstSeen, imported.firstSeen].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  if (firstSeen.length)
    merged.firstSeen = Math.min(...firstSeen)

  const activeDays = [existing?.activeDays, imported.activeDays].filter(
    (value): value is number => typeof value === 'number',
  )
  if (activeDays.length)
    merged.activeDays = Math.max(...activeDays)

  return merged
}

// ==========================================
// Deciding whether to import on its own
// ==========================================

/** Where a running or finished import publishes itself for the UI to watch. */
export const HISTORY_IMPORT_STATE_KEY = '__visilantHistoryImport'

/** Marks that the one-off automatic import has already been decided on. */
export const HISTORY_AUTO_IMPORT_KEY = '__visilantHistoryAutoImported'

function isVisitRecord(value: unknown): value is SiteVisitData {
  if (!value || typeof value !== 'object')
    return false
  const record = value as Partial<SiteVisitData>
  return typeof record.count === 'number' && typeof record.lastSeen === 'number'
}

/**
 * Does this profile already hold visit data?
 *
 * Visit records share `storage.local` with a handful of internal keys, so the
 * shape of the value decides this, not the key.
 */
export function hasVisitRecords(records: Record<string, unknown>): boolean {
  return Object.values(records).some(isVisitRecord)
}

/**
 * Decide whether the one-off automatic import should run.
 *
 * A fresh install always imports. Until it has seen the user's own sites the
 * extension knows nothing it can call familiar, so it would warn about the bank,
 * the mailbox and everything else on day one – noise that looks like a broken
 * extension and takes dozens of clicks to teach away.
 *
 * An update only imports into an empty profile. Someone who has been using the
 * extension already has counts that are their own history of it. Rewriting them
 * from the browser behind their back is not ours to do.
 */
export function shouldAutoImport(options: {
  reason: string
  alreadyDecided: boolean
  records: Record<string, unknown>
}): boolean {
  if (options.alreadyDecided)
    return false
  if (options.reason === 'install')
    return true
  if (options.reason === 'update')
    return !hasVisitRecords(options.records)
  return false
}

// ==========================================
// Running an import
// ==========================================

export type HistoryImportStatus = 'running' | 'done' | 'cancelled' | 'failed'

/**
 * `reading` is the single `history.search()` call and has no progress to report.
 * `scanning` is the per-URL visit lookup of a full import, and `saving` is the
 * write back into storage.
 */
export type HistoryImportPhase = 'reading' | 'scanning' | 'saving'

export interface HistoryImportState {
  status: HistoryImportStatus
  mode: 'quick' | 'full'
  phase: HistoryImportPhase
  /** Progress inside the current phase. A `total` of 0 means "no count yet". */
  current: number
  total: number
  /** Hostnames stored and visits behind them – final once status is `done`. */
  domains: number
  visits: number
  /** When the import stopped. 0 while it is still running. */
  finishedAt: number
  /** Part of the automatic chain, so the background is allowed to resume it. */
  auto: boolean
  /** Heartbeat. A `running` state that stopped ticking was killed, not finished. */
  updatedAt: number
  /** Times the automatic import has been picked up again after being killed. */
  attempts: number
  /**
   * When a full pass last completed, carried across runs.
   *
   * Without it a later quick refresh would look like the only import that ever
   * ran, and the settings page would claim the first-visit dates are missing
   * when they are sitting in storage.
   */
  fullDoneAt: number
}

/** A running import that stopped publishing for this long was killed. */
export const IMPORT_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000

/** Is an import actually in flight, as opposed to a `running` state left behind? */
export function isImportAlive(state: HistoryImportState | null, now: number): boolean {
  return !!state && state.status === 'running' && now - (state.updatedAt || 0) < IMPORT_HEARTBEAT_TIMEOUT_MS
}

/**
 * What to tell the user about the state of their import.
 *
 * `partial` is the case worth spelling out: visit counts are in, so warnings
 * behave correctly, but no full pass ever finished, so the dates are blank and
 * running one by hand is worth it. `interrupted` looks the same as running from
 * the state alone and is told apart by the heartbeat.
 */
export type ImportHealth = 'never' | 'running' | 'complete' | 'partial' | 'interrupted' | 'cancelled' | 'failed'

export function describeImportHealth(
  state: HistoryImportState | null,
  now: number,
  runningHere = false,
): ImportHealth {
  if (runningHere || isImportAlive(state, now))
    return 'running'
  if (!state)
    return 'never'
  if (state.status === 'running')
    return 'interrupted'
  if (state.status === 'failed')
    return 'failed'
  if (state.status === 'cancelled')
    return state.fullDoneAt ? 'complete' : 'cancelled'
  return state.fullDoneAt ? 'complete' : 'partial'
}

/** How many `history.getVisits()` calls a full import keeps in flight at once. */
const IMPORT_CONCURRENCY = 12
/** Hostnames written per `storage.local.set()` call. */
const IMPORT_WRITE_BATCH = 500
/** Scanned URLs between two published progress updates. */
const IMPORT_PUBLISH_EVERY = 200
/**
 * Roughly how many URLs a full import scans between checkpoints.
 *
 * The unit is deliberately URLs and not hostnames: one hostname can hold
 * thousands of pages, so a fixed number of hostnames per checkpoint would make
 * the interval between saves wildly uneven.
 */
const IMPORT_CHECKPOINT_URLS = 2000

/**
 * Does this hostname still need the slow per-visit pass?
 *
 * `activeDays` can only come from reading individual visits, so its presence is
 * the record saying so itself – which is what makes an interrupted full import
 * resumable without a separate cursor to keep in sync.
 */
export function needsDetailPass(record: SiteVisitData | undefined): boolean {
  return typeof record?.activeDays !== 'number'
}

/**
 * Import visit counts from the browser history into `storage.local`.
 *
 * Quick mode uses the per-URL summary the browser already keeps (visit count and
 * last visit time) – one API call in total, but it cannot say when the user first
 * visited a site. Full mode additionally asks for the individual visits of every
 * URL, which yields a real `firstSeen` and a real active-day count at the cost of
 * one call per URL.
 *
 * A full import saves as it goes, in checkpoints of whole hostnames, so a browser
 * that is closed halfway does not throw the work away – `resume` then picks up at
 * the hostnames that have no `activeDays` yet. Checkpointing by hostname rather
 * than by position matters: active days are counted per hostname, so a hostname
 * split across a checkpoint would have its days counted twice over and merged by
 * max, quietly under-reporting.
 *
 * Progress is both handed to `onProgress` (for whoever started it) and written to
 * `HISTORY_IMPORT_STATE_KEY` (for any other context watching), because the
 * automatic import runs in the background while the welcome page watches from a
 * tab that may be opened, closed or reloaded at any point.
 */
export async function runHistoryImport(options: {
  mode: 'quick' | 'full'
  onProgress?: (state: HistoryImportState) => void
  shouldStop?: () => boolean
  /** Skip hostnames a previous full pass already finished. */
  resume?: boolean
  /** Mark the state as resumable by the background. */
  auto?: boolean
  attempts?: number
}): Promise<HistoryImportState> {
  const { mode, onProgress, shouldStop, resume, auto = false, attempts = 0 } = options

  const state: HistoryImportState = {
    status: 'running',
    mode,
    phase: 'reading',
    current: 0,
    total: 0,
    domains: 0,
    visits: 0,
    finishedAt: 0,
    auto,
    updatedAt: Date.now(),
    attempts,
    // Whatever an earlier run achieved is still in storage, so it survives here too
    fullDoneAt: (await readHistoryImportState())?.fullDoneAt || 0,
  }

  const publish = async () => {
    state.updatedAt = Date.now()
    onProgress?.({ ...state })
    await browser.storage.local.set({ [HISTORY_IMPORT_STATE_KEY]: { ...state } })
  }

  const finish = async (status: HistoryImportStatus) => {
    state.status = status
    state.finishedAt = Date.now()
    if (status === 'done' && mode === 'full')
      state.fullDoneAt = state.finishedAt
    await publish()
    return { ...state }
  }

  /** Fold a batch of finished hostnames into what is already stored. */
  const writeHostnames = async (
    hostnames: string[],
    stats: Map<string, ImportedDomainStats>,
    onBatch?: (written: number) => Promise<void>,
  ) => {
    for (let offset = 0; offset < hostnames.length; offset += IMPORT_WRITE_BATCH) {
      const chunk = hostnames.slice(offset, offset + IMPORT_WRITE_BATCH)
      const existing = await browser.storage.local.get(chunk)
      const payload: Record<string, SiteVisitData> = {}

      for (const hostname of chunk) {
        payload[hostname] = mergeImportedStats(
          existing[hostname] as SiteVisitData | undefined,
          stats.get(hostname)!,
        )
      }

      await browser.storage.local.set(payload)
      await onBatch?.(Math.min(offset + chunk.length, hostnames.length))
    }
  }

  try {
    await publish()

    const history = await browser.history.search({
      text: '',
      maxResults: 999999, // can't be 0 bcs of firefox
      startTime: 0, // from the beginning
    })

    // Only http(s) pages on dotted hostnames are tracked, the rest is dropped here
    // so it never reaches the progress total or the per-URL visit lookups.
    const pages: { url: string, hostname: string, lastVisitTime?: number, visitCount?: number }[] = []
    for (const item of history) {
      const hostname = hostnameFromHistoryUrl(item.url)
      if (hostname && item.url) {
        pages.push({
          url: item.url,
          hostname,
          lastVisitTime: item.lastVisitTime,
          visitCount: item.visitCount,
        })
      }
    }

    if (mode === 'full') {
      // Sorted so that a resumed run walks the same order as the run it continues
      const urlsByHostname = new Map<string, string[]>()
      for (const page of pages) {
        const urls = urlsByHostname.get(page.hostname)
        if (urls)
          urls.push(page.url)
        else
          urlsByHostname.set(page.hostname, [page.url])
      }
      let hostnames = [...urlsByHostname.keys()].sort()

      // Hostnames an earlier run already finished, and what they hold, so the
      // totals a resumed run reports still describe the whole history
      let carriedDomains = 0
      let carriedVisits = 0
      if (resume) {
        const stored = await browser.storage.local.get(hostnames)
        const pending: string[] = []
        for (const hostname of hostnames) {
          const record = stored[hostname] as SiteVisitData | undefined
          if (needsDetailPass(record)) {
            pending.push(hostname)
          }
          else {
            carriedDomains++
            carriedVisits += record?.count || 0
          }
        }
        hostnames = pending
      }

      state.phase = 'scanning'
      state.current = 0
      state.total = hostnames.reduce((sum, hostname) => sum + (urlsByHostname.get(hostname)?.length || 0), 0)
      await publish()

      let sincePublish = 0
      let cursor = 0
      while (cursor < hostnames.length) {
        if (shouldStop?.())
          return await finish('cancelled')

        // One checkpoint's worth of whole hostnames
        const checkpoint: string[] = []
        let urlCount = 0
        while (cursor < hostnames.length && (checkpoint.length === 0 || urlCount < IMPORT_CHECKPOINT_URLS)) {
          const hostname = hostnames[cursor++]
          checkpoint.push(hostname)
          urlCount += urlsByHostname.get(hostname)?.length || 0
        }

        const stats = new Map<string, ImportedDomainStats>()
        const daysByHostname = new Map<string, Set<string>>()
        const daysFor = (hostname: string) => {
          let days = daysByHostname.get(hostname)
          if (!days) {
            days = new Set<string>()
            daysByHostname.set(hostname, days)
          }
          return days
        }

        const work = checkpoint.flatMap(hostname =>
          (urlsByHostname.get(hostname) || []).map(url => ({ hostname, url })),
        )

        await mapWithConcurrency(
          work,
          IMPORT_CONCURRENCY,
          async (item) => {
            try {
              const visits = await browser.history.getVisits({ url: item.url })
              const times = visits
                .map(visit => visit.visitTime)
                .filter((time): time is number => typeof time === 'number')
              const merged = addVisitTimes(stats.get(item.hostname), times, daysFor(item.hostname))
              if (merged)
                stats.set(item.hostname, merged)
            }
            catch {
              // A URL can disappear between search() and getVisits() – skip it
            }
            state.current++
            // Publishing every item would mean a storage write per history entry
            if (++sincePublish >= IMPORT_PUBLISH_EVERY) {
              sincePublish = 0
              await publish()
            }
          },
          shouldStop,
        )

        if (shouldStop?.())
          return await finish('cancelled')

        // Every URL of these hostnames has been read, so their day counts are final
        for (const [hostname, entry] of stats)
          entry.activeDays = daysByHostname.get(hostname)?.size || undefined

        await writeHostnames([...stats.keys()], stats)
        state.domains += stats.size
        state.visits += [...stats.values()].reduce((sum, entry) => sum + entry.count, 0)
        await publish()
      }

      state.domains += carriedDomains
      state.visits += carriedVisits
      return await finish('done')
    }

    const stats = new Map<string, ImportedDomainStats>()
    for (const page of pages) {
      const lastVisit = page.lastVisitTime
      if (typeof lastVisit !== 'number' || lastVisit <= 0)
        continue

      const existing = stats.get(page.hostname)
      stats.set(page.hostname, {
        count: (existing?.count || 0) + (page.visitCount || 1),
        lastSeen: Math.max(existing?.lastSeen || 0, lastVisit),
      })
    }

    if (shouldStop?.())
      return await finish('cancelled')

    const hostnames = [...stats.keys()]
    state.phase = 'saving'
    state.current = 0
    state.total = hostnames.length
    await publish()

    await writeHostnames(hostnames, stats, async (written) => {
      state.current = written
      await publish()
    })

    state.domains = hostnames.length
    state.visits = [...stats.values()].reduce((sum, entry) => sum + entry.count, 0)
    return await finish('done')
  }
  catch (error) {
    console.error('History import failed:', error)
    return await finish('failed')
  }
}

/** The last published import state, or null if no import has ever run. */
export async function readHistoryImportState(): Promise<HistoryImportState | null> {
  const stored = await browser.storage.local.get(HISTORY_IMPORT_STATE_KEY)
  return (stored[HISTORY_IMPORT_STATE_KEY] as HistoryImportState | undefined) || null
}

/**
 * Run an async task over items with a bounded number of in-flight calls.
 *
 * The full import makes one `history.getVisits()` call per URL, which on a large
 * history is tens of thousands of calls – they have to be queued rather than fired
 * at once, and the user has to be able to stop them.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  let cursor = 0

  const worker = async () => {
    while (cursor < items.length) {
      if (shouldStop?.())
        return
      const index = cursor++
      await task(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  )
}
