import type { SiteVisitData } from './storage'
import { visitKey } from './domain-boundary'
import { HISTORY_IMPORT_STATE_KEY } from './history-import'
import { visitRecordEntries } from './visit-reset'
import { runVisitStep } from './visit-store'

/**
 * One-off: the records kept under `www.X` move into `X`.
 *
 * Every write and read now goes through `visitKey`, so a record still sitting
 * under a `www.` name is one nothing will ever read again – and the site it
 * belongs to would read as a stranger to somebody who has been there every day.
 *
 * `'merged'` is a half-way mark, written in the same `set` as the merged records.
 * The worker can be stopped at any moment, and stopped between writing `X` and
 * deleting `www.X` it would otherwise add the same visits to `X` a second time
 * on the next start. Found half-way, the next run only finishes the deleting.
 */
export const WWW_FOLD_KEY = '__visilantWwwFolded'

/**
 * Two records of one site, as one.
 *
 * The same fold a family verdict already takes (`aggregateFamiliarityStats`),
 * so no family total and no familiar-index entry moves: visits add up, since a
 * navigation is only ever counted under one name. Active days take the larger,
 * which undercounts days spent on both names exactly as the family fold does,
 * and the first visit takes the earlier.
 *
 * Silenced if either one was. Lifting a silence writes the flag back to false on
 * a record that already exists, which looks exactly like never having silenced
 * it, so a true is the only value here that is known to be somebody's choice.
 */
export function mergeVisitRecords(a: SiteVisitData | undefined, b: SiteVisitData): SiteVisitData {
  if (!a)
    return { ...b, ignored: b.ignored === true }

  const merged: SiteVisitData = {
    count: a.count + b.count,
    lastSeen: Math.max(a.lastSeen, b.lastSeen),
    ignored: a.ignored === true || b.ignored === true,
  }

  const firstSeen = [a.firstSeen, b.firstSeen].filter((value): value is number => typeof value === 'number' && value > 0)
  if (firstSeen.length)
    merged.firstSeen = Math.min(...firstSeen)

  const activeDays = [a.activeDays, b.activeDays].filter((value): value is number => typeof value === 'number')
  if (activeDays.length)
    merged.activeDays = Math.max(...activeDays)

  return merged
}

/**
 * What the fold has to write and what it has to delete, from a snapshot.
 *
 * Only keys `visitKey` would change are touched, which is not the same as every
 * key starting with `www.`: `www.co.uk` and `www.github.io` are their own names.
 */
export function planWwwFold(all: Record<string, unknown>): { merged: Record<string, SiteVisitData>, stale: string[] } {
  const merged: Record<string, SiteVisitData> = {}
  const stale: string[] = []
  const records = new Map(visitRecordEntries(all))

  for (const [key, record] of records) {
    const target = visitKey(key)
    if (target === key)
      continue
    stale.push(key)
    merged[target] = mergeVisitRecords(merged[target] ?? records.get(target), record)
  }

  return { merged, stale }
}

/**
 * Run the fold, once, in the same line as every visit write.
 *
 * Queued before anything else the worker starts – an import resuming after the
 * update, the first navigation, a silence pressed in the popup – so none of
 * them lands on a record the fold has not reached yet. The import in particular
 * already writes folded counts taken with max, and merged after it the same
 * visits would be added twice.
 *
 * Resolves to whether anything moved, so the caller knows to redraw the tabs.
 */
export function foldWwwRecords(): Promise<boolean> {
  return runVisitStep(async () => {
    const flag = (await browser.storage.local.get(WWW_FOLD_KEY))[WWW_FOLD_KEY]
    if (flag === true)
      return false

    const all = await browser.storage.local.get(null)
    const { merged, stale } = planWwwFold(all)

    if (flag !== 'merged') {
      const writes: Record<string, unknown> = { ...merged, [WWW_FOLD_KEY]: 'merged' }

      // A full pass that was cut short walks hostnames in sorted order and
      // resumes after the last one it finished. Folding moves names across that
      // point, so a host it never scanned could be skipped for good. Starting
      // the pass over costs a rescan and changes nothing, it folds by min and max.
      const state = all[HISTORY_IMPORT_STATE_KEY] as { cursor?: string } | undefined
      if (state && typeof state === 'object' && state.cursor)
        writes[HISTORY_IMPORT_STATE_KEY] = { ...state, cursor: '' }

      await browser.storage.local.set(writes)
    }

    if (stale.length)
      await browser.storage.local.remove(stale)
    await browser.storage.local.set({ [WWW_FOLD_KEY]: true })
    return stale.length > 0
  })
}
