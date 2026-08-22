import type { Settings } from '~/logic/storage'
import { computed, ref } from 'vue'
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

/**
 * Load a locale, and say which one is actually on screen.
 *
 * Not the same question as which one was asked for: a profile can name a locale
 * this build no longer ships, and the fallback below answers it in English.
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

// Function to get translation for a key
function getTranslation(key: string): string {
  if (!loadedTranslations.value || Object.keys(loadedTranslations.value).length === 0) {
    return key // Return key if translations aren't loaded yet
  }
  return loadedTranslations.value[key]?.message || key
}

export function useContentI18n() {
  const t = computed(() => (key: string) => {
    return getTranslation(key)
  })

  const setLanguage = async (lang: string) => {
    // Don't set isLoaded to false as it causes the UI to disappear
    // Just update the language and translations
    const loaded = await loadTranslations(lang)
    // What is on screen, not what was asked for
    currentLanguage.value = loaded?.locale || 'en'
  }

  // Load saved language preference
  async function init() {
    try {
      if (appSettings.value?.selectedLanguage) {
        const loaded = await loadTranslations(appSettings.value.selectedLanguage)
        currentLanguage.value = loaded?.locale || 'en'
      }
      else {
        await loadTranslations('en')
      }
    }
    catch (error) {
      console.error('Error loading language preference:', error)
      await loadTranslations('en')
    }
    isLoaded.value = true
  }

  // Load saved language preference
  init().catch(console.error)

  // Watch for changes in settings
  browser.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue) {
      const newSettings = changes.settings.newValue as Settings
      if (newSettings.selectedLanguage && newSettings.selectedLanguage !== currentLanguage.value) {
        setLanguage(newSettings.selectedLanguage)
      }
    }
  })

  return {
    t,
    setLanguage,
    currentLanguage,
    isLoaded,
  }
}
