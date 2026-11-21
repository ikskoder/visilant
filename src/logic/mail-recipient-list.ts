import type { EmailRecipientInfo, EmailTooltipInfo } from '~/logic/ui-state'
import { isJudgedByVisits, isKnownMailDomain } from '~/logic/email-providers'
import { usernameRedFlag } from '~/logic/username-characters'

/**
 * Where a mail link stands, over everybody it writes to: whether all of them
 * are addresses the reader can take as known, and whether any of that is
 * unknown.
 *
 * One answer for the click, which is held on it, and for the button in the
 * tooltip, which is drawn as a risk on it. They used to be worked out apart,
 * the button from the first address alone: a link to a known address with a
 * forwarding one in `bcc=` was held, under a calm button with an arrow.
 *
 * Familiar only if every recipient is at a public provider or at a familiar
 * ordinary domain: an unfamiliar address in `cc=` behind a known one in
 * front went through, and so did any address at a throwaway service.
 *
 * Unchecked when a lookup failed for a domain that is judged by visits, a
 * failed lookup about gmail.com changes nothing, and when the link names
 * anybody who was not checked at all: an entry that does not read as an
 * address, which a mail program may still take.
 */
export function mailLinkStanding(
  email: Pick<EmailTooltipInfo, 'providerKind' | 'recipients' | 'recipientsNotChecked'>,
  first: { isSafe: boolean, unchecked?: boolean },
): { familiar: boolean, unchecked: boolean } {
  const everyone = email.recipients?.length
    ? email.recipients
    : [{ providerKind: email.providerKind, isSafe: first.isSafe, unchecked: first.unchecked }]
  return {
    familiar: everyone.every(recipient => isKnownMailDomain(recipient.providerKind, recipient.isSafe)),
    unchecked: (email.recipientsNotChecked ?? 0) > 0
      || everyone.some(recipient => isJudgedByVisits(recipient.providerKind) && Boolean(recipient.unchecked)),
  }
}

/**
 * Whether a `mailto:` gets its list of recipients drawn. Only when there is
 * more than one, or some were left unchecked, so an ordinary single-address
 * link keeps the shape it always had.
 */
export function recipientsAreListed(recipients: EmailRecipientInfo[] | undefined, notChecked = 0): boolean {
  return Boolean(recipients) && (recipients!.length > 1 || notChecked > 0)
}

/** The addresses that list shows, or none when it is not drawn. */
export function listedAddresses(recipients: EmailRecipientInfo[] | undefined, notChecked = 0): string[] {
  return recipientsAreListed(recipients, notChecked)
    ? recipients!.map(recipient => `${recipient.analysis.localPart}@${recipient.analysis.domain}`)
    : []
}

/**
 * The recipients in the order the list draws them: by domain, then by
 * username, so every address at one domain stands together. Each keeps a row
 * of its own, since two at one domain are two people. A name and its
 * lookalike sort side by side, `c0rp.test` just above `corp.test`, which is
 * where the difference is easiest to see.
 *
 * By the domain exactly as the address has it, already in lower case.
 * Nothing is folded: `www.corp.test` and `corp.test` are two mail hosts.
 * Usernames count their numbers as numbers, so `person2` comes before
 * `person10`.
 */
export function sortedRecipients(recipients: EmailRecipientInfo[]): EmailRecipientInfo[] {
  return [...recipients].sort((a, b) =>
    a.analysis.domain.localeCompare(b.analysis.domain) || a.analysis.localPart.localeCompare(b.analysis.localPart, undefined, { numeric: true }))
}

/**
 * Whether any address a mail link writes to has a username made to pass for
 * another, a red flag of its own. One answer for the hold on the click and the
 * button in the tooltip, as `mailLinkStanding` is.
 */
export function mailUsernameRedFlag(email: Pick<EmailTooltipInfo, 'analysis' | 'recipients'>): boolean {
  return [email.analysis, ...(email.recipients ?? []).map(recipient => recipient.analysis)].some(analysis => usernameRedFlag(analysis.localPart))
}
