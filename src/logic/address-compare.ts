/**
 * Two addresses lined up character against character.
 *
 * Reading an address letter by letter is the advice, and it is advice nobody
 * follows well: `rnicrosoft` and `microsoft` are the same shape to a reader who
 * already believes the message. When there is an earlier address to compare
 * against – one out of a thread that went somewhere – the eyes do not have to be
 * the instrument. The user pastes it, and the difference is pointed at.
 *
 * Aligned rather than compared index by index. One inserted character shifts
 * everything after it, so a straight positional comparison would light up the
 * whole rest of the address and hide which character was actually added. The
 * alignment below is the usual longest-common-subsequence one, which reports an
 * insertion as an insertion.
 */

/** Longer than any address anyone will paste, and the bound on the table below. */
const MAX_LENGTH = 320

export interface AddressCell {
  /** From the address being checked. Absent where the alignment has no character. */
  checked?: string
  /** From the address the user already trusts. Absent for the same reason. */
  known?: string
  same: boolean
}

export interface AddressComparison {
  /** One column per aligned position, in reading order. */
  cells: AddressCell[]
  /** How many columns hold something other than a plain match. */
  differences: number
  identical: boolean
  /**
   * Equal once case is set aside, but not written the same way.
   *
   * Worth saying rather than showing as a row of differences: a domain is
   * case-insensitive, and mail servers in practice treat the name that way too,
   * so this is a difference in typing rather than a different address.
   */
  sameIgnoringCase: boolean
}

/** Code points, not UTF-16 units – a character is what a reader sees. */
function characters(value: string): string[] {
  return Array.from(value).slice(0, MAX_LENGTH)
}

/**
 * The longest run of characters the two share, as a table of lengths.
 *
 * Both addresses are bounded above, so the table is at most 320 by 320. That is
 * a hundred thousand small integers built once per comparison, which is nothing
 * next to the render that follows it.
 */
function commonLengths(left: string[], right: string[]): number[][] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () => Array.from<number>({ length: right.length + 1 }).fill(0))

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  return table
}

export function compareAddresses(checked: string, known: string): AddressComparison {
  const left = characters(checked)
  const right = characters(known)
  const table = commonLengths(left, right)

  const cells: AddressCell[] = []
  let i = 0
  let j = 0

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      cells.push({ checked: left[i], known: right[j], same: true })
      i++
      j++
    }
    // Whichever side keeps more of the shared run is the side that carries on,
    // so the extra character is attributed to the other one
    else if (table[i + 1][j] >= table[i][j + 1]) {
      cells.push({ checked: left[i], same: false })
      i++
    }
    else {
      cells.push({ known: right[j], same: false })
      j++
    }
  }

  for (; i < left.length; i++)
    cells.push({ checked: left[i], same: false })
  for (; j < right.length; j++)
    cells.push({ known: right[j], same: false })

  const differences = cells.filter(cell => !cell.same).length

  return {
    cells,
    differences,
    identical: differences === 0,
    sameIgnoringCase: differences > 0 && checked.toLowerCase() === known.toLowerCase(),
  }
}
