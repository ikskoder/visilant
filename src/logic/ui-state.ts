import { ref } from 'vue'

export const showWarning = ref(false)
export const warningType = ref<'input' | 'copy'>('input')
export const safetyLevel = ref<boolean | null>(null)
export const isIgnored = ref(false)
export const hasNotifiedOnThisPage = ref(false)

// Link safety tooltip state
export interface LinkTooltipData {
  domain: string
  count: number
  isSafe: boolean
  mismatch: { textDomain: string } | null
  punycode: string | null
  position: { top: number, left: number }
  href: string
}

export const linkTooltipVisible = ref(false)
export const linkTooltipData = ref<LinkTooltipData | null>(null)

// Link safety intercept dialog state
export interface LinkInterceptData {
  domain: string
  url: string
  count: number
  isSafe: boolean
  mismatch: { textDomain: string } | null
  punycode: string | null
}

export const linkInterceptVisible = ref(false)
export const linkInterceptData = ref<LinkInterceptData | null>(null)
export const linkInterceptResolve = ref<((proceed: boolean) => void) | null>(null)

// Callback to cancel tooltip grace timer (set by content script, called by tooltip component)
const _onTooltipHoverEnter = { fn: null as (() => void) | null }
export const onTooltipHoverEnter = _onTooltipHoverEnter
export function setOnTooltipHoverEnter(fn: () => void) {
  _onTooltipHoverEnter.fn = fn
}
