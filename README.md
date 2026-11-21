# Visilant Browser Extension

<p align="center">
  <a href="https://chromewebstore.google.com/detail/visilant/cangpjiaklckllaeppbdhhpcmhjambak"><img alt="For Chromium-based browsers: Chrome Web Store" src="docs/badge-chrome-web-store.svg" height="64"></a>
  <a href="https://addons.mozilla.org/en-GB/firefox/addon/visilant/"><img alt="For Firefox-based browsers: Firefox Add-ons" src="docs/badge-firefox-add-ons.svg" height="64"></a>
</p>

<p align="center">
  <sub><b>Chromium-based</b>, for example Chrome, Edge, Brave, Opera, Vivaldi.<br>
  <b>Firefox-based</b>, for example Firefox on desktop and on Android, LibreWolf, Waterfox, Zen, Floorp.<br>
  Those are the best-known ones rather than a full list. Whether any particular browser takes the package is up to its own extension policy.</sub>
</p>

This README describes the source in this branch. For the published v3.2.0 build, see the [README at the release tag](https://github.com/ikskoder/visilant/tree/v3.2.0#readme).

## Contents

- [What is Visilant?](#what-is-visilant)
- [Real-Life Example: How Visilant Could Stop a Phishing Attack](#real-life-example-how-visilant-could-stop-a-phishing-attack)
- [Key Features](#key-features)
  - [Link Safety – Proactive Link Analysis](#link-safety--proactive-link-analysis)
  - [Address Analysis](#address-analysis)
  - [Email Addresses](#email-addresses)
  - [Advanced Homograph Protection](#advanced-homograph-protection)
  - [Interactive Popup Dashboard](#interactive-popup-dashboard)
  - [Theming & Responsive UI](#theming--responsive-ui)
  - [Smart Detection](#smart-detection)
  - [Hardened Security](#hardened-security)
- [Getting Started](#getting-started)
  - [Notification Triggers](#notification-triggers)
- [Privacy Considerations](#privacy-considerations)
- [Reproducible Builds](#reproducible-builds)
- [Limitations](#limitations)
- [Contributing & Feedback](#contributing--feedback)
- [License](#license)

## What is Visilant?

Visilant is a lightweight, cross-browser extension designed primarily to protect you from phishing sites that aim to steal your credentials by tricking you into voluntarily entering them, typically through visual similarity to legitimate websites.

The core idea is simple: most phishing websites are those you have never visited or visited very rarely. Visilant uses your own visit history as the signal, so unlike traditional antivirus solutions it can alert you about a phishing site immediately – even one created minutes ago and not yet included in any security blacklist or antivirus database.

Visilant counts visits to public web hosts. It checks links for address mismatches and suspicious domains before navigation, and warns about selected interactions on unfamiliar sites.

Link Safety can pause a click for review, and the optional paste guard can hold a paste on an unfamiliar site. You decide whether to continue.

## Real-Life Example: How Visilant Could Stop a Phishing Attack

Imagine you're exhausted after a long flight or simply distracted by everyday demands. You click on a link that seems to be from a trusted service. Without Visilant, you might inadvertently enter your credentials on a visually convincing fake site, unknowingly handing them over to attackers – as cybersecurity expert Troy Hunt (creator of [Have I Been Pwned](https://haveibeenpwned.com/)) described after a [2025 phishing incident](https://www.troyhunt.com/a-sneaky-phish-just-grabbed-my-mailchimp-mailing-list). Even if you’ve successfully identified phishing attempts in the past, a single moment of inattention can lead to a compromise. Phishing-resistant authentication, such as passkeys where a service supports them, is an important complementary defence. Visilant instead provides a visual prompt to pause, reconsider and verify the address before you enter credentials.

## Key Features

### Link Safety – Proactive Link Analysis
Visilant can show a link's destination and how well you know it before you navigate.

- **Opening a check**: The default trigger is **Check this link** in the browser's right-click menu. Switch to hover to see a tooltip after a configurable delay on external web links and email links. The check shows where the link leads, whether you know the destination, and any visit facts you chose to show. On a touchscreen a long press opens the same browser menu, so **Check this link** works there too. Firefox for Android gives extensions no menu items, so on a phone the check appears in the dialog of a click that Link Safety holds.
- **Stopping a click**: By default, Link Safety holds external web links with at least one red flag or links that use a known shortener. You can raise the red flag threshold or also hold links to any unfamiliar site. When a required check fails, the dialog can say the link went unchecked. In the main page the hold also covers middle clicks, image maps, SVG links and email links. For a web link in a frame, the hold applies to a plain click and the dialog appears over the main page. If a cross-origin frame needs a fresh click to open a new tab or navigate the main page, the dialog asks you to click the link again.
- **URL Mismatch Detection**: A classic phishing trick is making a link's visible text look like one domain (e.g. `paypal.com`) while the actual destination is completely different. Visilant detects this and shows a side-by-side comparison table with the familiarity status and every familiarity fact for both domains, check by check.
- **Punycode / Unicode Detection**: Domains containing non-Latin characters that visually resemble Latin ones (homograph attacks) are flagged, with the ASCII (punycode) representation displayed.
- **Shortened URL Detection**: Visilant can follow short links to reveal their destination. Resolution can be off, on demand with a button in the check, or automatic. You can display the redirect steps Visilant observes, offer resolution for any web link, mark additional domains as shorteners, or update the list from remote sources. The browser can follow several HTTP redirects in one request, so the displayed chain may omit intermediate hops.
- **The link dialog**: A held web link opens a confirmation dialog with the destination, familiarity facts, red flags, any mismatch with the link text, and the resolved destination if available. You can go back or continue. In automatic resolution mode, a link held only because it is a short link or leads to an unfamiliar site can open directly if that destination is familiar.
- **Context Menu Integration**: On browsers with extension context menus, **Site details in a new tab** opens the dashboard for a web link's host, and **Address details in a new tab** opens the check page for a `mailto:` link's recipients. Both are available with Link Safety off. With Link Safety on and the right-click trigger selected, **Check this link** also works for links within the current site and compares the destination with the text captured for a link in the main page. **Check this email link** inspects the recipients of a mail link. Both can fall back to opening the check page when the in-page script is unavailable. The menu also offers **Check selected text with Visilant** and **Scan QR code with Visilant**. Firefox for Android lacks these extension menu actions.
- **Scope Control**: Choose which pages get hover checks and automatic click holds. Apply them everywhere, only to listed domains, or everywhere except listed domains. The explicit context-menu checks remain available outside that scope.

### Address Analysis
Wherever an address is shown – the link tooltip, the intercept dialog, the popup, the check field – Visilant states what is notable about it. None of these is a verdict. They are facts about the address, shown next to your visit history so you can judge it yourself.

- **Structural markers**: Visilant flags URL user information before `@`, a public IP address in place of a hostname, a domain embedded in another site's subdomains, and certain mixed-script or non-Latin domain labels. It also points out deep subdomain nesting and shows when a site is hosted by a shared platform. These last two are cautions, not red flags. Each of the others rests on how URLs and DNS work, so an attacker cannot avoid one without giving up the trick it enables.
- **Resemblance to sites you know**: Visilant compares the address with sites that meet your familiarity rules. It can point out substituted letters or digits, typos, names padded with extra words, and familiar domains placed in subdomains. Strong matches count as red flags, and weaker matches are shown as cautions. The display underlines changed characters when it can identify them. Because the comparison uses your history rather than a shipped list of brands, it differs for every user and an attacker cannot test a domain against it in advance. Weaker resemblances stay quiet so they never train you to dismiss the warning.
- **External lookups**: a collapsed list of links to third-party services – VirusTotal, urlscan.io and Google Safe Browsing out of the box. These are links, not integrations: no API keys, no rate limits, and nothing is requested until you click one. The list is editable in settings, one `Name = https://example.com/check/{domain}` per line, so you can point it at whatever you actually use.

### Email Addresses
The part after the @ is a domain like any other, so everything above applies to it – plus what is particular to mail:

- **Public, temporary and forwarding email services**: Visilant labels these services and uses the service type in place of the visit verdict. An entry found only in a downloaded public-provider list adds a note and is still judged by visits. Public and temporary service lists can be updated from URLs. Forwarding services, such as Firefox Relay, DuckDuckGo Email Protection and SimpleLogin, take built-in and manual entries.
- **Where the mail is read**: Visilant can show visit facts for a provider's webmail site, such as `mail.google.com` for `gmail.com`. Add mappings in settings with entries such as `example.com = mail.example.com`, or supply a URL to a list of mappings.
- **Address lookalikes**: Email checks compare domains with familiar sites and known email providers. A username with letters from another script that resemble Latin letters also counts as a red flag.
- **Email links**: Checks read recipients from `To`, `Cc` and `Bcc`. A link with several recipients shows a table. Hover checks and held clicks can also compare an address shown in the link text with the actual recipients.

### Advanced Homograph Protection
Visilant employs several techniques to help you spot spoofed domains:
- **Address marking**: Frames help distinguish the site's name from its subdomains and suffix or hosting platform. The question mark beside an address opens a breakdown of those parts and the username where applicable. Digits are bold in a colour of their own, any character in a host name outside a to z, 0 to 9 and the hyphen is marked red, so is any non-ASCII character in a username, and invisible characters are shown by their code point. Latin letters are deliberately left unstyled: colouring them would read as a verdict on the ordinary part of an address and drown out the one character that matters.
- **Punycode Display**: Toggle between Unicode and Punycode (ASCII) formats to reveal internationalized domain attacks where characters look identical to Latin ones.
- **Secure Rendering**: Uses a specialized rendering component to prevent visual spoofing techniques.

### Interactive Popup Dashboard
Clicking the extension icon reveals a dashboard where you can:
- View visit statistics for the current host and for its domain family. Sites on a shared hosting platform are grouped under their own site names.
- **Pick the Number**: The list of related hosts shows one figure per host. Choose visits, active days, days known, or how many checks the host passes. The family summary adds visits, shows the highest active-day count of any member, and uses the earliest known visit for days known.
- **Sort Sites**: Order the list by that number or by name, to understand your history with a domain family.
- **Customize Display**: Turn the frames off, change text case (uppercase/lowercase), switch Punycode modes, and adjust font size on the fly.
- **Per-Site Warnings Switch**: Use the popup to silence or resume typing, copying and paste warnings for the current site. Settings lists your silenced sites and lets you remove entries.
- **Per-Site Anti-Tampering Toggle**: See whether tamper detection is active for the current site and quickly disable or re-enable it without leaving the popup.
- **Check Anything by Hand**: Open the check field from the popup to inspect a URL, domain, email address or `mailto:` link. Paste, drop or choose a QR code image to read its contents. On browsers with extension context menus, you can also check selected text from the page.

### Theming & Responsive UI

- **Light / Dark / System Theme**: Pick a theme that suits your environment or follow your system preference.
- **Responsive Layout**: The popup and settings adapt to narrow widths – works when opened in a tab or on mobile-form-factor windows.

### Smart Detection
- **One Site With or Without www.**: `www.example.com` and `example.com` are counted, judged and silenced as one site, so a bank you read daily at `www.` does not look new the first time a link drops the prefix. A link between the two stays on the site. Records kept separately by earlier versions are merged once, automatically.
- **Local addresses**: Visilant leaves local names such as `localhost` and `printer.lan`, and private IPs such as `192.168.1.1`, out of visit tracking and familiarity-based warnings on the page. If Link Safety holds a link to one of these addresses, the dialog says **Link to your local network**.

### Hardened Security
Visilant implements multiple layers of protection to ensure reliable operation even on malicious sites:
- **Early Injection**: Content scripts load at `document_start`, so protection starts early in the page load.
- **Event Capturing**: Keyboard, input and clipboard listeners are registered in the capture phase so the extension can handle them early in the event flow.
- **Anti-Tampering Protection**: A MutationObserver watches the extension's in-page UI. Removal or concealment is repaired first and reported only if it keeps happening – a site that draws its own pages throws its body away on every route and loses the container as a side effect, so once it is put back it stays back, while a page set on removing it has to keep taking it away. What survives that is an alarm and a system notification. The check can still be disabled per-site (from the popup or via an exclusion list in settings) for trusted sites that set it off anyway.
- **Randomized DOM Footprint**: The extension container uses a randomly generated ID for each page load, making it harder for malicious scripts to detect Visilant's presence by querying specific element IDs.
- **Overlay Protection**: The extension uses the browser's top layer for dialogs, link tooltips and typing warnings where available. The tamper watcher also checks whether the page is covering an active panel.

## Getting Started

1. **Install Visilant from your preferred browser's extension store:**

   - [Visilant for Chromium-based browsers](https://chromewebstore.google.com/detail/visilant/cangpjiaklckllaeppbdhhpcmhjambak). The manifest requires Chrome 119 or later.
   - [Visilant for Firefox-based browsers](https://addons.mozilla.org/en-GB/firefox/addon/visilant/). The manifest requires Firefox 140 or later on desktop and Firefox 142 or later on Android.

2. Pin the Visilant icon to your browser toolbar for constant visibility (recommended due to [Script Injection Limitations](#limitations)). On Firefox for Android there is no toolbar to pin to – the icon, its colour and its counter are all there, under **Extensions** in the browser menu.

3. Click the Visilant icon to open the extension popup. It provides an overview of your visit history for the current site and allows quick access to display settings.

4. Click the Settings icon (gear) in the popup to open the full configuration page. Configure the extension according to your preferences:

   - **Familiarity rules**: A fresh profile requires all three checks to pass. The defaults are **10 visits**, **5 separate active days** and **10 days since the first known visit**. Profiles migrating from the older single visit threshold retain that rule. Choose which checks are enabled and whether the site must pass all of them, any one, or a minimum number.
     - Where a check shows familiarity facts, it lists the rules you have enabled. **Show what each check needs** adds each rule's threshold and whether it passed.
     - **_Note:_** Active days and first-visit dates only exist for sites recorded since those fields were added, and a site without them cannot pass those checks. A history import fills them in for every site the browser still remembers – for anything older than that, or removed by a clearing of history, there is nothing left to read, and the settings page says which case you are in. On Firefox for Android there is no history to read at all, so the older records keep only their visit count and everything visited from now on carries both dates from its first visit.
   - **Toolbar icon**:

     - Choose whether the icon carries a counter, and what that counter shows: any one of the checks you have switched on, or how many of them the site passes. With a single check in use there is nothing to choose between, so the question is not asked.
     - Turn on the optional icon colour change to show unfamiliar sites in red and silenced unfamiliar sites in grey. Silencing a site leaves its familiarity verdict and anti-tampering settings in effect.

   - **Link safety**:

     - Link Safety is enabled by default. It checks links on pages and shows where each one leads and how well you know that site.
     - Choose the right-click menu (the default) or hover with a configurable delay. Click holds use their own settings.
     - Choose which clicks are held for a dialog first. Links with at least one red flag and short links are held by default. You can raise the flag threshold, exempt a service's own short links on its site, or also hold links to any unfamiliar site.
     - Choose when link checks show familiarity facts. They can appear always, never, only for unfamiliar sites, or only for familiar sites.
     - Configure short-link resolution. The default is on demand. You can turn it off, enable automatic resolution, show the full resolved URL and observed redirect steps, or offer resolution for any web link. The separate click-hold setting can still pause a known short link with resolution off.
     - Set the scope: all websites, only specific domains, or everywhere except certain domains.

   - **General**: Choose a light, dark, or system-matching theme, and decide whether the settings page explains itself. The explanations are on by default and worth keeping unless you know the settings by heart – switching them off only makes the page shorter.

   - **Email addresses**: Add public, temporary and forwarding email services. Use remote sources for the public and temporary lists or for mappings from an email domain to its webmail site.

   - **Check elsewhere**: Edit the third-party services offered under a checked domain, one `Name = https://example.com/check/{domain}` per line. Clear the field for none at all.

   - **Anti-tampering**: List the sites where the tamper check should stay out of the way – ones that rebuild their page constantly and set it off for no reason.

   - **Notifications**:

     - Select typing, copying, or both as notification triggers. Both are on by default. See [Notification Triggers](#notification-triggers).
     - Choose system notifications, in-page warnings, or both. In-page warnings are the default.
     - **Hold pastes on unfamiliar sites** works independently of **Show warnings** and is off by default. When a paste is held, **Allow pasting** lets you repeat it and lets later pastes through on that page. If the site became familiar while the paste was held, the dialog tells you it has changed.
     - **Sites you have silenced**: The warnings for one site are turned off in the popup, whatever the familiarity rules say about it, and this list names every site you have done that to – one host to a line. Delete a line to bring its warnings back. A site on the list that is familiar by now gets no warnings anyway, so the page names those sites and removes them with one button. An opt-in setting does the same on its own: a site leaves the list on your next visit once it is familiar, which matters only if you later make the familiarity rules stricter. The in-page warning deliberately carries no such button, only a line saying where the switch is: a page that wants to be trusted can write "press Don't show again to continue" beside its own login form, and it has no way to reach the popup.
     - You can also disable notifications completely if you prefer a non-intrusive browsing experience. However, be sure to check the visit count on the extension icon during important interactions, as otherwise, the extension's effectiveness is greatly diminished.

   Sections with preferences have their own reset buttons. **Your data** controls resetting visit records or preferences across the extension. Use the silenced-sites list or the popup to resume warnings for individual sites.

5. Where the browser provides history access, Visilant imports it on install. It uses the available visits to count visits and active days and find the first known visit for each tracked host. The import is read on the device and stays there – nothing is uploaded, and no site is contacted. It can be cancelled. An interrupted automatic import can resume, and **Your data** lets you run an import again.
     - **_Note:_** Dates are labelled "first known visit" because they can only reflect what is still in your browser history – clearing history removes visits that cannot be recovered.

### Notification Triggers

The extension triggers alerts (if enabled) only during specific interactions that phishing sites commonly exploit:

- **Keyboard Input or Content Paste**: Warnings cover typing and pasting into editable fields, including forms in frames. Input from an IME, dictation or a phone's suggestion bar can also trigger them when the browser reports an edit. Interaction warnings in frames use the familiarity of the main page.

- **Content Cutting or Copying**: Although less common in phishing attacks, this trigger was added after viewing YouTube [video](https://www.youtube.com/watch?v=Wm0kqSlyEjE) demonstrating a phishing exploit involving clipboard manipulation ([reCAPTCHA Phish](https://github.com/JohnHammond/recaptcha-phish)). It covers the user copying or cutting, and a page putting text in the clipboard by itself, the way a fake "verify you are human" check (ClickFix) loads a command before asking you to press Win+R and paste. A page can do that in two ways and both are caught: the old `document.execCommand('copy')`, and the Clipboard API (`navigator.clipboard.writeText()` and `write()`), which fires no copy event at all. The page's write is never blocked, only warned about, with the same settings, the same familiarity check and the same silenced sites as an ordinary copy. The warning appears when the page asks to write, so a write the browser then refuses still raises it.

**_Note:_** File downloads aren't listed as dangerous interactions because humans typically detect suspicious downloads easily, and handling virus-infected files is best left to antivirus software. Visilant addresses a specific gap not covered by traditional antiviruses.

## Privacy Considerations

Visilant is open-source and operates locally within your browser:

- **There is no server behind Visilant**, no account and no telemetry. Every analysis described above – visit counts, structural markers, resemblance to sites you know – runs in your browser against data you already have.
- **Visit records stay on the device.** The extension keeps per-host visit statistics in local extension storage. Silenced sites and manually maintained or downloaded domain lists and webmail mappings are stored locally too.
- **Preferences use browser sync storage.** If you have browser sync switched on, your browser copies them to your other browsers through your browser account – Mozilla's or Google's, not ours. Switch browser sync off and they stay on this machine. They include link scope rules, anti-tampering exclusions, lookup templates and remote source URLs.
- **Optional features that use the network**:
  - **External lookups** offer links to third-party services. They are ordinary links, not integrations – Visilant sends nothing, and no service learns anything unless you choose to open it. Whichever one you open will, like any site you visit, see the domain you asked about and your IP address.
  - **Short-link resolution** requests the link and follows redirects with cookies omitted and no referrer. In the default on-demand mode the request starts when you press the resolve button in a check. If you enable automatic resolution, a check can send the request before you open the destination.
  - **Scanning a QR code from a page image** downloads the image from its source URL when you choose **Scan QR code with Visilant**. The site serving the image sees that request. Images you paste, drop or choose from disk are decoded locally.
- **Remote lists** are fetched without cookies when you press **Update**. The shortener, public-provider and temporary-email lists include default source URLs. You can supply your own sources for any of those lists or for webmail mappings. A domain found only in a downloaded public-provider list is still judged by visits.
- The extension requests only the permissions necessary for proper operation:

  **Required permissions:**
  - **Tabs**: To detect the current website you're visiting and update the extension icon with visit count.
  - **Storage**: To keep your visit history on this device and your settings where the browser keeps preferences, which is the sync storage described above.
  - **Notifications**: To show system warnings about typing and clipboard activity when selected, anti-tampering alerts, and QR scan results when the result cannot be shown in the page.
  - **Context Menus**: To add right-click actions for links, selected text and QR-code images where the browser supports them.
  - **Host permissions** (`*://*/*`): To inject content scripts that monitor keyboard and clipboard interactions and analyze links on all websites.
  - **Browser history**: To turn available browser history into per-host visit counts, first and last known visits, and active days. A fresh install imports automatically. An update can also import if the profile has no visit counts and has never made the automatic import decision. The history is read in the browser and never leaves it. Only a visit count, a first and last date and a number of active days are kept per hostname, with no page addresses, no titles and no search terms. You can re-run the import or clear visit data under **Your data**.

  Firefox for Android has no history API. There the import cannot run at all, and the settings page says so instead of offering a button that would do nothing.

## Reproducible Builds

You do not have to take our word for what the store installed. Every release can be rebuilt from its tag, byte for byte. For example, to check the Firefox archive for v3.2.0:

```bash
nix build github:ikskoder/visilant/v3.2.0#firefox
sha256sum result/*.xpi          # compare with SHA256SUMS on the release
```

`scripts/verify.sh <downloaded.xpi>`, run from the matching release tag, goes one step further and compares the copy your browser actually installed with a fresh build, file by file, skipping only the metadata the store adds when it signs. Release archives also carry a Sigstore-signed provenance attestation tying them to the commit and workflow that built them, and anyone can rerun the build in a fork through the **reproduce** workflow.

Node, pnpm and every dependency are pinned through `flake.lock` and `pnpm-lock.yaml`, and the archive is packed with fixed timestamps and sorted entries, which is what makes two builds identical. Full instructions are in [REPRODUCE.md](REPRODUCE.md).

## Limitations

While Visilant enhances awareness of "unfamiliar" websites, its limitations include:

- **Not a Malware Blocker**: Visilant doesn’t detect or block malicious code, downloads, or trackers. It helps you assess addresses and familiarity, but it is not a replacement for an antivirus.

- **Relies on User Action**: Most protection is advisory: you must notice and act on the warnings. The optional paste guard delays a paste for review, but it does not decide whether a site is legitimate.

- **False Positives and Negatives**: Legitimate sites with low visit counts may trigger warnings (false positives), while phishing sites visited repeatedly may go unflagged (false negatives).

- **Compromised Trusted Sites**: If attackers gain control of a legitimate domain you've previously visited, Visilant won't detect it as suspicious since your visit history marks it as "familiar." However, at that point, you're likely facing a much larger security breach – such as a domain hijack or server compromise – where Visilant's lack of protection is the least of your concerns.

- **Partial Cross-Device Sync**: While your configuration settings are synced across devices (if you're logged into your browser), your visit history is stored locally to accommodate its size. This means a site marked as "familiar" on one computer will still be treated as "unfamiliar" on another until you visit it enough times there. Installing Visilant on that machine imports its history for you, which is what closes most of the gap – except on Firefox for Android, which does not let extensions read its history, so a phone starts from nothing and learns as you browse.

- **Clipboard writes a page can hide**: Catching the Clipboard API means wrapping `writeText()` and `write()` in the page's own JavaScript, and a hostile page has one known way round that. It creates a frame and, in the same instant, takes the frame's own unwrapped copy of the method, before the browser has run any extension script inside it, then calls it on the page's clipboard. The write goes through with no warning. In Chrome and current Firefox this works with a `srcdoc`, blob, `javascript:` or sandboxed frame. In Firefox 140 it works with an ordinary empty frame as well. No extension can close this from inside the page: a fresh frame can be reached through `window[0]` or `frames[0]`, and a fresh window through `window.open()`, and none of these passes through anything an extension can intercept. The same timing gap applies to `execCommand('copy')` run in such a frame. A related, harder trick borrows the method of a frame that has already loaded, which is reported, but at a moment the page chooses, and a page that also runs itself almost out of stack at that moment may keep the report from arriving. A page that writes to the clipboard and navigates away at once also takes the in-page warning with it. Treat any site that asks you to paste something into Win+R, a terminal or a "Run" box as hostile, whatever Visilant shows.

- **A page can tell that Visilant is installed**: A page can find out that the extension is there, and a scam aimed at Visilant's users could change its approach. In Chrome the extension's files sit at an address that is the same for every install, so a page can try to load its style sheet or its text strings and see whether that works (Firefox gives every install an address of its own). On every browser the wrapped clipboard methods look different from the browser's own if a page reads their source, and the box Visilant draws its warnings in is an element in the page. That box is put on every page whenever any of Visilant's protections is on, whether you know the site or not, so its presence says nothing about your visits. What a page can still do is provoke a check and watch what happens. After you have clicked on it, it can copy something to your clipboard and see whether a warning appears, or place a link to a near copy of a site and see whether your click on it is held. A warning that appears only on unfamiliar sites, or only for a link that imitates a site you know, can be seen by the page it appears on. This needs you to act on that page, and you would see the warning it provoked.

- **Script Injection Limitations**: In-page features depend on the browser allowing content scripts to run. Some browser pages, store pages, PDFs and tabs opened before an installation or update may lack a content script. Anti-tampering protection can report attempts to remove or hide the in-page UI, but a hostile page can still interfere with page-level code. One concrete case: a page that calls `document.open()` wipes every event listener in the document, Visilant's included. Visilant notices and puts its own back, but only once the page's script has finished, so a page that adds a listener of its own in that same script, to swallow your keystrokes before Visilant sees them, can keep the typing warning from appearing. The interaction listeners rely on browser-generated events, so fields filled using synthetic events can go unobserved. The icon remains accessible from the desktop toolbar or the **Extensions** menu on Firefox for Android.

Understanding these limitations is crucial for Visilant's effective use.

## Contributing & Feedback

Visilant is open source, and contributions are welcome, with some considerations:

- The developer's current workload may delay review of issues or pull requests.
- Please check existing issues before creating new ones.
- Pull requests adding third-party libraries should have strong justification.
- The developer reserves the right to reject pull requests deemed unsafe or misaligned with project goals.

## License

The source in this branch is distributed under the [MIT License](LICENSE). For a published release, see the license at its tag.
