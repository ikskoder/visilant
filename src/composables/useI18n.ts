import { computed, ref, watch } from 'vue'
import { settings as appSettings } from '~/logic/storage'

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

const translationCache: TranslationCache = {}
const loadedTranslations = ref<Messages>({})
const currentLanguage = ref('en')
const isLoaded = ref(false)

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

// Function to get translation for a key
function getTranslation(key: string): string {
  if (!loadedTranslations.value || Object.keys(loadedTranslations.value).length === 0) {
    return key // Return key if translations aren't loaded yet
  }
  return loadedTranslations.value[key]?.message || key
}

export function useI18n() {
  const t = computed(() => (key: string) => {
    return getTranslation(key)
  })

  const setLanguage = async (lang: string) => {
    // Update the source of truth
    if (appSettings.value)
      appSettings.value.selectedLanguage = lang
  }

  // Sync with settings
  watch(
    () => appSettings.value?.selectedLanguage,
    async (newLang) => {
      if (newLang) {
        // Load translations FIRST to avoid UI flickering with old texts
        await loadTranslations(newLang)
        // THEN update the current language state
        currentLanguage.value = newLang
        isLoaded.value = true
      }
    },
    { immediate: true },
  )

  // Fallback: manually check storage to ensure we have the latest value
  // This helps if useWebExtensionStorage is slow or fails to sync initially
  browser.storage.sync.get('settings').then(async (data) => {
    try {
      if (data?.settings) {
        let parsed: any = data.settings
        // Handle potential double-serialization or raw object
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          }
          catch (e) {
            console.error('Failed to parse settings:', e)
          }
        }

        if (parsed?.selectedLanguage && parsed.selectedLanguage !== currentLanguage.value) {
          currentLanguage.value = parsed.selectedLanguage
          await loadTranslations(parsed.selectedLanguage)

          // Also update appSettings if it's out of sync
          if (appSettings.value && appSettings.value.selectedLanguage !== parsed.selectedLanguage) {
            appSettings.value.selectedLanguage = parsed.selectedLanguage
          }
        }
      }
    }
    catch (e) {
      console.error('Error in manual storage check:', e)
    }
  })

  return {
    t,
    setLanguage,
    currentLanguage,
    isLoaded,
    loadedTranslations,
  }
}
