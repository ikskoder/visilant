/**
 * Is this domain, or any parent of it, in the set?
 *
 * Walked from the domain rather than over the set. The lists these are asked
 * about are large – the built-in shortener list alone is ~2.5 thousand domains,
 * and a remote email list is allowed a hundred thousand – and asking every entry
 * whether the domain ends in it meant that many string comparisons for every
 * link on a page and every address checked. A hostname has a handful of labels,
 * so asking the set about each parent costs a handful of lookups however far the
 * list grows.
 */
export function matchesDomainSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain))
    return true

  let rest = domain
  let dot = rest.indexOf('.')
  while (dot !== -1) {
    rest = rest.slice(dot + 1)
    if (set.has(rest))
      return true
    dot = rest.indexOf('.')
  }
  return false
}
