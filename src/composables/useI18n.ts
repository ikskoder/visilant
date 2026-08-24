import { computed, ref, triggerRef } from 'vue'
import { runtime, storage } from 'webextension-polyfill'

// Type for message format
interface Message {
  message: string
  description: string
}

// Type for messages object
interface Messages {
  [key: string]: Message
}

// Cache for loaded translations
interface TranslationCache {
  [locale: string]: Messages
}

// Module-level state (singleton pattern)
const translationCache: TranslationCache = {}
const loadedTranslations = ref<Messages>({})
const currentLanguage = ref('en')
const isLoaded = ref(false)
let initPromise: Promise<void> | null = null

/**
 * Load a locale, and say which one is actually on screen.
 *
 * Not the same question as which one was asked for: a profile can name a locale
 * this build no longer ships, and the fallback below answers it in English. The
 * returned name is what got loaded, so the rest of the state can say English
 * rather than keep insisting on a language nothing is being shown in.
 */
async function loadTranslations(lang: string): Promise<{ messages: Messages, locale: string } | null> {
  // Check if translations are already cached
  if (translationCache[lang]) {
    loadedTranslations.value = translationCache[lang]
    return { messages: translationCache[lang], locale: lang }
  }

  try {
    // Load translations from _locales folder
    const response = await fetch(browser.runtime.getURL(`/_locales/${lang}/messages.json`))
    if (!response.ok) {
      throw new Error(`Failed to load translations for ${lang}`)
    }
    const translations = await response.json()

    // Cache translations
    translationCache[lang] = translations
    loadedTranslations.value = translations
    return { messages: translations, locale: lang }
  }
  catch (error) {
    console.error(`Error loading translations for ${lang}:`, error)
    // A profile can name a locale this build does not ship – one dropped since
    // it was chosen, or one synced from a build that had more. English is the
    // only locale guaranteed to be there, and raw message keys on screen are a
    // far worse outcome than the wrong language.
    if (lang !== 'en')
      return loadTranslations('en')
    return null
  }
}

// Parse settings from storage (handles both string and object)
function parseSettings(data: any): any {
  if (!data?.settings)
    return null

  let parsed = data.settings
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    }
    catch (e) {
      console.error('Failed to parse settings:', e)
      return null
    }
  }
  return parsed
}

// Set language and update all necessary state
async function applyLanguage(lang: string): Promise<void> {
  const wasAlreadyLoaded = lang === currentLanguage.value && isLoaded.value

  const loaded = await loadTranslations(lang)
  // What is on screen, not what was asked for
  currentLanguage.value = loaded?.locale || 'en'
  isLoaded.value = true

  // Force reactivity trigger even if language was the same
  // This ensures computed properties recalculate
  if (!wasAlreadyLoaded) {
    triggerRef(loadedTranslations)
    triggerRef(currentLanguage)
  }
}

// Initialize i18n from storage - runs once
async function initializeI18n(): Promise<void> {
  try {
    // Read directly from storage for initial load
    const data = await storage.sync.get('settings')
    const parsed = parseSettings(data)
    const lang = parsed?.selectedLanguage || 'en'

    await applyLanguage(lang)
  }
  catch (e) {
    console.error('Error initializing i18n:', e)
    // Fallback to default language
    await applyLanguage('en')
  }
}

// Setup storage change listener (runs once at module load)
// This handles changes from OTHER contexts (popup, other tabs)
let listenerSetup = false
function setupStorageListener(): void {
  if (listenerSetup)
    return
  listenerSetup = true

  storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'sync' || !changes.settings)
      return

    try {
      const newValue = changes.settings.newValue
      const parsed = typeof newValue === 'string' ? JSON.parse(newValue) : newValue
      const newLang = parsed?.selectedLanguage

      if (newLang && newLang !== currentLanguage.value) {
        await applyLanguage(newLang)
      }
    }
    catch (e) {
      console.error('Error handling storage change:', e)
    }
  })
}

// Setup listener immediately at module load
setupStorageListener()

export function useI18n() {
  // Computed that depends on loadedTranslations ref
  // This ensures reactivity when translations change
  const t = computed(() => {
    // Access loadedTranslations.value to establish dependency
    const translations = loadedTranslations.value
    return (key: string): string => {
      if (!translations || Object.keys(translations).length === 0) {
        return key
      }
      return translations[key]?.message || key
    }
  })

  const setLanguage = async (lang: string) => {
    // Update translations immediately for responsive UI
    await applyLanguage(lang)

    // Through the one writer, like every other settings edit. This used to read
    // the whole blob, put the language in it and write all of it back - the
    // read-modify-write from a second context that the background writer exists
    // to do away with. Storing it still reaches every context, through the
    // change event.
    await runtime.sendMessage({ type: 'patch-settings', data: { patch: { selectedLanguage: lang } } })
  }

  // Initialize on first use (singleton pattern)
  if (!initPromise) {
    initPromise = initializeI18n()
  }

  return {
    t,
    setLanguage,
    currentLanguage,
    isLoaded,
    loadedTranslations,
  }
}
