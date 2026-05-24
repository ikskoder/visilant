import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { settings } from '~/logic/storage'

const isDark = ref(false)

let initialized = false
let mediaQuery: MediaQueryList | null = null
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(theme: string): boolean {
  if (theme === 'dark')
    return true
  if (theme === 'light')
    return false
  return getSystemDark()
}

export function useTheme(root?: HTMLElement | null) {
  const apply = (dark: boolean) => {
    isDark.value = dark
    if (root) {
      root.classList.toggle('dark', dark)
    }
    else {
      document.documentElement.classList.toggle('dark', dark)
    }
  }

  if (!initialized || root) {
    // Set up system preference listener
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaListener = (e: MediaQueryListEvent) => {
      if (settings.value.theme === 'system') {
        apply(e.matches)
      }
    }
    mediaQuery.addEventListener('change', mediaListener)

    // Watch theme setting changes
    watch(() => settings.value.theme, (theme) => {
      apply(resolveTheme(theme))
    }, { immediate: true })

    if (!root) {
      initialized = true
    }
  }

  onBeforeUnmount(() => {
    if (mediaQuery && mediaListener) {
      mediaQuery.removeEventListener('change', mediaListener)
    }
  })

  return { isDark: computed(() => isDark.value) }
}
