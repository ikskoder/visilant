import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * The keyboard behaviour every one of these dialogs was missing.
 *
 * All three of them interrupt something the user was doing - a click, a paste, a
 * check they asked for - and none of them took the keyboard with them. Focus
 * stayed on the page underneath the overlay, so Tab walked through a page the
 * user could not see, Escape did nothing, a screen reader was never told a
 * dialog had opened, and pressing Enter again could set off a second intercept
 * behind the first.
 *
 * What this does, in the order it matters:
 *
 * - puts focus on a named safe control when the dialog opens, never on the one
 *   that goes through with the risky thing
 * - keeps Tab inside the dialog while it is open
 * - closes on Escape
 * - gives focus back to whatever had it before, so the page carries on where the
 *   user left it
 *
 * The `role` and `aria-modal` attributes belong on the dialog element and are
 * left to the template, which is the only place that knows which element that is.
 */
export function useModalDialog(options: {
  visible: () => boolean
  /** Where focus goes when the dialog opens. The safe choice, not the risky one. */
  initialFocus: () => HTMLElement | null | undefined
  /** The dialog element, whose descendants Tab is kept inside. */
  container: () => HTMLElement | null | undefined
  onEscape: () => void
}) {
  /** What had focus before the dialog took it, so it can be handed back. */
  const previouslyFocused = ref<HTMLElement | null>(null)

  const focusable = (): HTMLElement[] => {
    const root = options.container()
    if (!root)
      return []

    return Array.from(root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.offsetParent !== null || element.getClientRects().length > 0)
  }

  function onKeydown(event: KeyboardEvent) {
    if (!options.visible())
      return

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      options.onEscape()
      return
    }

    if (event.key !== 'Tab')
      return

    const items = focusable()
    if (!items.length)
      return

    const root = options.container()
    const active = (root?.getRootNode() as Document | ShadowRoot | null)?.activeElement as HTMLElement | null
    const first = items[0]
    const last = items[items.length - 1]

    // Wrapped by hand, because the dialog is inside a shadow root on a page whose
    // own elements are all still in the tab order behind it
    if (event.shiftKey && (active === first || !active || !items.includes(active))) {
      event.preventDefault()
      last.focus()
    }
    else if (!event.shiftKey && (active === last || !active || !items.includes(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  watch(options.visible, (open) => {
    if (open) {
      const root = options.container()
      const doc = (root?.getRootNode() as Document | ShadowRoot | null) ?? document
      previouslyFocused.value = (doc as Document).activeElement as HTMLElement | null
      window.addEventListener('keydown', onKeydown, true)
      // After the transition has put the element in the tree
      nextTick(() => options.initialFocus()?.focus())
      return
    }

    window.removeEventListener('keydown', onKeydown, true)
    // Back where it was, so the page carries on where the user left it
    previouslyFocused.value?.focus?.()
    previouslyFocused.value = null
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true)
  })
}
