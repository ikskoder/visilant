/**
 * Where a case sits in the contents: what the user is looking at, then which
 * side of it. Matched on the picture name, first match wins, and the order here
 * is the order of the catalogue. A name nothing matches lands under "Other"
 * rather than dropping out of sight.
 */
export const SECTIONS: [surface: string, topic: string, names: RegExp][] = [
  ['On a web page', 'Typing and copy warnings', /^warning-/],
  ['On a web page', 'Link tooltip: familiar or not', /^(tooltip-(familiar|unfamiliar|thresholds)|tt-(some-visits|subdomain|count|single|unknown|rule|thresholds))/],
  ['On a web page', 'Link tooltip: lookalikes', /^(tooltip-punycode|tt-(look|idn)-)/],
  ['On a web page', 'Link tooltip: a suspicious address', /^tt-mark-/],
  ['On a web page', 'Link tooltip: text names another site', /^(tooltip-mismatch|tt-mm-)/],
  ['On a web page', 'Link tooltip: short links', /^(tooltip-shortener|tt-(short|once)-)/],
  ['On a web page', 'Link tooltip: size and position', /^tt-(above|right|font|long)/],
  ['On a web page', 'Email links', /^(tooltip-email-|em-)/],
  ['On a web page', 'QR codes and selected text', /^(tooltip-qr|qr-|sel-)/],
  ['On a web page', 'Link dialog', /^(dialog-link|dlg-)/],
  ['On a web page', 'Paste dialog', /^(dialog-paste|paste-)/],
  ['On a web page', 'Check panel', /^(panel-|cp-)/],
  ['Toolbar popup', 'Familiar or not', /^(popup-(unfamiliar|family|thresholds)|pp-(rule|legacy|new-|root|solo|www))/],
  ['Toolbar popup', 'Lookalikes', /^(popup-punycode|pp-(look|idn|mixed|punycode))/],
  ['Toolbar popup', 'A suspicious address', /^pp-mark-/],
  ['Toolbar popup', 'The list of relatives', /^pp-(family|metric|sort)/],
  ['Toolbar popup', 'Warnings and anti-tampering', /^(popup-silenced|pp-(silenced|warnings|tamper))/],
  ['Toolbar popup', 'Special sites', /^(popup-(shortener|no-site)|pp-(localhost|dotted|private|public|platform|tenant|custom|tab-view))/],
  ['Toolbar popup', 'Size and text', /^(popup-large|pp-(font|name|highlight|upper))/],
  ['Toolbar popup', 'Site details page', /^(details-|pp-details)/],
  ['Check page', 'Empty and leftover', /^(check-(empty|nothing)|ck-stale)/],
  ['Check page', 'Sites and links', /^(check-(url|lookalike|punycode|unknown|shortener)|ck-(expand|userinfo|text-with))/],
  ['Check page', 'Email addresses', /^(check-email|ck-(account|custom|email|embedded|local|provider|mailsite|markers))/],
  ['Check page', 'Mailto with several recipients', /^(check-mailto|ck-(mailto|prefilled))/],
  ['Check page', 'Comparing two addresses', /^(check-compare|ck-compare)/],
  ['Check page', 'Phone, text, Wi-Fi, places, QR', /^ck-(geo|sms|tel|wifi|invisible|qr)/],
  ['Check page', '"Check elsewhere" links', /^ck-lookups/],
  ['Settings', 'The whole page', /^(options-(full|compact)|opt-(all|nav|write|reset))/],
  ['Settings', 'General', /^options-general/],
  ['Settings', 'Familiarity', /^(options-familiarity|opt-fam)/],
  ['Settings', 'Link check and short links', /^(options-link|opt-ls)/],
  ['Settings', 'Notifications', /^(options-notif|opt-notif)/],
  ['Settings', 'Display', /^(options-display|opt-display)/],
  ['Settings', 'Email lists', /^(options-email|opt-email)/],
  ['Settings', '"Check elsewhere" links', /^(options-lookups|opt-lookups)/],
  ['Settings', 'Anti-tampering', /^(options-tamper|opt-tamper)/],
  ['Settings', 'Your data and import', /^(options-data|opt-data)/],
  ['Welcome page', 'Import on install', /^welcome-/],
  ['Toolbar button', 'Icon and badge', /^toolbar/],
]

/** The surface and topic a picture belongs under, and where that topic comes in the contents. */
export function placeOf(name: string): [surface: string, topic: string, at: number] {
  const at = SECTIONS.findIndex(([, , names]) => names.test(name))
  return at < 0 ? ['Other', 'Not placed in the contents yet', SECTIONS.length] : [SECTIONS[at][0], SECTIONS[at][1], at]
}
