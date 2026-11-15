/**
 * Whether the facts behind a verdict are on show, by the "Show visit facts"
 * setting. One function: the tooltip, the dialog and the comparison table each
 * had a copy of this switch.
 */
export function showsVisitFacts(setting: 'always' | 'never' | 'unfamiliar' | 'familiar', isSafe: boolean): boolean {
  switch (setting) {
    case 'always': return true
    case 'never': return false
    case 'unfamiliar': return !isSafe
    case 'familiar': return isSafe
    default: return true
  }
}
