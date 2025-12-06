import { computed, ref, triggerRef } from 'vue'
import { storage } from 'webextension-polyfill'

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

// Function to load translations for a language
async function loadTranslations(lang: string): Promise<Messages | null> {
  // Check if translations are already cached
  if (translationCache[lang]) {
    loadedTranslations.value = translationCache[lang]
    return translationCache[lang]
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
    return translations
  }
  catch (error) {
    console.error(`Error loading translations for ${lang}:`, error)
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

  await loadTranslations(lang)
  currentLanguage.value = lang
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

    // Persist to storage - this triggers storage.onChanged for other contexts
    await storage.sync.get('settings').then(async (data) => {
      const parsed = parseSettings(data) || {}
      parsed.selectedLanguage = lang
      await storage.sync.set({ settings: JSON.stringify(parsed) })
    })
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
