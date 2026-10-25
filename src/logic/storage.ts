import type { Settings } from './settings-schema'
import { createWebExtensionStorage } from '~/composables/useWebExtensionStorage'
import { defaultFamiliaritySettings } from './familiarity'
import { isMessageError } from './message-error'
import { DEFAULT_SHORTENER_LIST_URL, defaultSettings, normalizeLinkSafety, parseStoredSettings } from './settings-schema'
import { SETTINGS_NOT_SAVED } from './storage-error'

export * from './settings-schema'

const settingsStorage = createWebExtensionStorage<Settings>(
  'settings',
  defaultSettings,
  {
    mergeDefaults: true,
  },
)

export const settings = settingsStorage.data

/** The last save that did not happen, so the settings page can say so. */
export const settingsWriteError = settingsStorage.writeError

/**
 * Take a settings object handed over by another context.
 *
 * Assigning to `settings.value` would look identical and would also save the
 * value straight back – which is how a context holding a stale copy used to
 * overwrite the real one. This puts it in the ref and stops there.
 */
export function applySettingsSnapshot(value: Settings): void {
  settingsStorage.applyExternal(value)
}

/**
 * Give up the right to write settings.
 *
 * Called by every context that only shows what the settings say. One writer for
 * one blob – see the note on `setWritable`.
 */
export function makeSettingsReadOnly(): void {
  settingsStorage.setWritable(false)
}

/**
 * The settings keys where two objects disagree, as a patch of the first.
 *
 * Built out of the serialized form on purpose. The value handed in is the
 * reactive one every control is bound to, and a message is structured-cloned on
 * its way to the background: a reactive proxy cannot be cloned, so a patch
 * carrying one would fail to send at all and no setting would ever save.
 */
export function settingsPatch(next: Settings, stored: Settings | null): Partial<Settings> {
  const plain = JSON.parse(JSON.stringify(next)) as Settings
  const patch: Partial<Settings> = {}
  for (const key of Object.keys(plain) as (keyof Settings)[]) {
    const before = stored ? stored[key] : undefined
    if (stored === null || JSON.stringify(before) !== JSON.stringify(plain[key]))
      (patch as Record<string, unknown>)[key] = plain[key]
  }
  return patch
}

/**
 * Edit the settings by asking the background to, rather than by writing them.
 *
 * Called by every page that edits them: the settings page and the popup, both of
 * which can be open at the same moment. They used to save the whole blob each,
 * having each read it separately - so two edits made seconds apart, to two
 * unrelated settings, ended with whichever page wrote last deciding the value of
 * both. Losing a sort order that way is a nuisance. Losing the paste guard,
 * because the popup still held the copy it read before the guard was switched
 * on, is the same mechanism taking a protection off.
 *
 * Only the keys this page changed travel, and the background merges them into
 * what is stored now. The value comes back the ordinary way, through the change
 * event every context already listens to.
 */
export function editSettingsThroughBackground(): void {
  settingsStorage.setCommit(async (next, stored) => {
    const patch = settingsPatch(next, stored)
    if (!Object.keys(patch).length)
      return

    const answer = await browser.runtime.sendMessage({ type: 'patch-settings', data: { patch } })
    if (isMessageError(answer))
      throw new Error(answer.error)
    if (!(answer as { success?: boolean })?.success)
      throw new Error(SETTINGS_NOT_SAVED)
  })
}

/**
 * Settings as they are actually stored, migrations included.
 *
 * Whoever answers questions about the settings – the background above all – has
 * to await this before answering the first one. Until it resolves the ref still
 * holds the shipped defaults, and a default handed out as the user's choice is
 * both a wrong answer and, one write later, a wrong setting.
 */
let settingsReadyPromise: Promise<void> | null = null

export function settingsReady(options: { migrate?: boolean } = {}): Promise<void> {
  settingsReadyPromise ??= (async () => {
    await settingsStorage.ready
    if (options.migrate) {
      await runSettingsMigrations()
      // The migration wrote the stored blob behind the ref's back, on purpose:
      // it works on the raw value, before defaults are merged over it
      await settingsStorage.hydrate()
    }
  })().catch((error) => {
    // A failure is not an answer, so it is not kept as one. Remembering the
    // rejected promise meant one storage error at startup - the kind that comes
    // of a disk being busy for a moment - left every later question about the
    // settings failing too, for as long as the worker lived. Forgetting it here
    // is what lets the next caller try again.
    settingsReadyPromise = null
    throw error
  })
  return settingsReadyPromise
}

/** Marks that the shipped text defaults have been put into the settings once. */
const TEXT_DEFAULTS_SEEDED_KEY = 'textDefaultsSeeded'

/** Marks that the shortener source has been offered to an existing profile once. */
const SHORTENER_SOURCE_SEEDED_KEY = 'shortenerSourceSeeded'

/** Marks that the old single-threshold setting has been carried over. */
const FAMILIARITY_MIGRATED_KEY = 'familiarityMigrated'

/** Marks that the link settings have been written in their two-part shape. */
const INTERCEPT_MIGRATED_KEY = 'interceptMigrated'

/** Every one-off pass over the stored settings, in the order they are applied. */
const MIGRATION_KEYS = [
  TEXT_DEFAULTS_SEEDED_KEY,
  SHORTENER_SOURCE_SEEDED_KEY,
  FAMILIARITY_MIGRATED_KEY,
  INTERCEPT_MIGRATED_KEY,
] as const

/** Fields whose default is content the user is meant to see and may delete. */
const SEEDED_TEXT_FIELDS = [
  'lookupServices',
  'disposableEmailListUrl',
  'publicEmailListUrl',
] as const

/**
 * Put the shipped text defaults into the settings, once per profile.
 *
 * Defaults are merged shallowly, so a stored empty string wins over the seeded
 * default and the field stays empty forever. That is exactly what an empty
 * field is supposed to mean here – no lookup links, no remote source – so the
 * value cannot simply be treated as missing. The flag draws the line instead:
 * seed once, then never touch these fields again, so a later clear stays clear.
 */
function seedTextDefaults(draft: Partial<Settings>): boolean {
  let changed = false
  for (const field of SEEDED_TEXT_FIELDS) {
    if (!draft[field]) {
      draft[field] = defaultSettings[field]
      changed = true
    }
  }
  return changed
}

/**
 * Give an existing profile the shortener source it never shipped with.
 *
 * Needed as its own pass rather than as another entry in `SEEDED_TEXT_FIELDS`:
 * that flag was set long ago on any profile old enough to be missing this, and
 * the field sits inside `linkSafety`, which the shallow default merge hands back
 * whole – a key added to it later never reaches a profile that already stored
 * one. Empty stays empty after this runs, the same as for the other sources: it
 * is a deliberate "no remote list", not a value that went missing.
 */
function seedShortenerSource(draft: Partial<Settings>): boolean {
  if (!draft.linkSafety || draft.linkSafety.shortUrlListUpdateUrl)
    return false

  draft.linkSafety = {
    ...draft.linkSafety,
    shortUrlListUpdateUrl: DEFAULT_SHORTENER_LIST_URL,
  }
  return true
}

/**
 * Carry a hand-set visit threshold into the new familiarity rules, once.
 *
 * Defaults are merged one level deep, so a profile stored before `familiarity`
 * existed comes back with the shipped rules – threshold 10 – and the 25 the user
 * had typed in is quietly gone. It cannot be read as a fallback either, since by
 * then the merged object is a complete, valid rule set with nothing missing to
 * fall back from. So it is copied across explicitly, before anything reads it,
 * and the flag makes sure a later edit down to 10 is not undone next startup.
 *
 * Reads the raw stored blob, never the hydrated ref: the ref has the defaults
 * merged into it, so `familiarity` is always present there and this would decide
 * there was nothing to carry over every single time.
 */
function migrateFamiliarity(draft: Partial<Settings>): boolean {
  // Already on the new rules, so there is nothing to carry over
  if (draft.familiarity)
    return false

  const legacy = Math.floor(Number(draft.safety))
  draft.familiarity = {
    ...defaultFamiliaritySettings,
    visits: {
      enabled: true,
      min: Number.isFinite(legacy) && legacy > 0 ? legacy : defaultFamiliaritySettings.visits.min,
    },
    // Off for a profile that is only arriving here now, whatever a new profile
    // starts with. Its records were written before active days and first-visit
    // dates existed, and a criterion whose fact was never recorded fails – so
    // switching these on during an update would declare every site the user
    // has ever known unfamiliar, all at once.
    activeDays: { ...defaultFamiliaritySettings.activeDays, enabled: false },
    age: { ...defaultFamiliaritySettings.age, enabled: false },
  }
  return true
}

/**
 * Write the link settings in their two-part shape, once.
 *
 * Every reader already goes through `normalizeLinkSafety`, so this only makes
 * the stored value say what is being read, a `click-left` turned into a
 * ticked "unfamiliar site" box among it. Once written, the boxes are what is
 * stored, and stored boxes win over any trigger beside them. What nothing can
 * tell apart: another device still on an old version syncing back a blob with
 * `click-left` and no boxes at all reads exactly like a profile that never
 * migrated, and ticks the box again.
 */
function migrateIntercept(draft: Partial<Settings>): boolean {
  if (!draft.linkSafety || (draft.linkSafety.intercept && (draft.linkSafety.tooltipTrigger as string) !== 'click-left'))
    return false
  draft.linkSafety = normalizeLinkSafety(draft.linkSafety)
  return true
}

/**
 * Every one-off pass over the stored settings, as one read and one write.
 *
 * They used to run as three independent fire-and-forget passes, each doing its
 * own read-modify-write of the same JSON blob while the settings ref was
 * hydrating alongside them. Whichever write landed last was the whole value, so
 * one pass could undo another – and each had already recorded itself as done, so
 * nothing ever ran again to put it right. One snapshot, one commit, and the
 * flags go up only once storage has been read back and agrees.
 *
 * Safe to run twice: every pass above is a no-op the second time.
 */
export async function runSettingsMigrations(): Promise<void> {
  const flags = await browser.storage.local.get(MIGRATION_KEYS as unknown as string[])
  const pending = MIGRATION_KEYS.filter(migrationKey => !flags[migrationKey])
  if (!pending.length)
    return

  const markDone = async () => {
    await browser.storage.local.set(Object.fromEntries(pending.map(migrationKey => [migrationKey, true])))
  }

  const stored = (await browser.storage.sync.get('settings')).settings
  // Nothing stored yet: a new profile starts on the defaults, which already
  // carry everything these passes would have added
  if (stored === undefined) {
    await markDone()
    return
  }

  const parsed = parseStoredSettings(stored)
  if (!parsed) {
    // Unreadable settings blob – leave it alone, the storage layer will reset
    // it. No flag goes up: nothing was carried over, and a readable blob later
    // still gets its migration.
    return
  }

  const draft: Partial<Settings> = { ...parsed }
  let changed = false
  if (pending.includes(TEXT_DEFAULTS_SEEDED_KEY))
    changed = seedTextDefaults(draft) || changed
  if (pending.includes(SHORTENER_SOURCE_SEEDED_KEY))
    changed = seedShortenerSource(draft) || changed
  if (pending.includes(FAMILIARITY_MIGRATED_KEY))
    changed = migrateFamiliarity(draft) || changed
  if (pending.includes(INTERCEPT_MIGRATED_KEY))
    changed = migrateIntercept(draft) || changed

  if (!changed) {
    await markDone()
    return
  }

  const written = JSON.stringify(draft)
  try {
    await browser.storage.sync.set({ settings: written })
  }
  catch {
    // Quota or a transient failure. The flag stays down so the next startup
    // tries again rather than recording a migration that never landed.
    return
  }

  // Read back before believing it. A write that resolved but stored something
  // else – or was overwritten before this line – must not be recorded as done:
  // the flag would forbid the retry that would put it right. Not marking it
  // costs one repeat of a pass that is a no-op the second time.
  if ((await browser.storage.sync.get('settings')).settings !== written)
    return

  await markDone()
}

// Define the site visit data structure
export interface SiteVisitData {
  count: number
  lastSeen: number // Unix timestamp of last visit
  ignored: boolean // Whether notifications are ignored for this site
  // Both fields are optional on purpose: records written before they existed have
  // no honest value for them, and only a browser-history import can supply one.
  firstSeen?: number // Unix timestamp of the earliest known visit
  activeDays?: number // Number of distinct local days the site was visited on
  // Silenced while it was already familiar, so the automatic lift leaves it be –
  // see canAutoLift. Absent on every record that is not silenced.
  silencedWhileFamiliar?: boolean
}
