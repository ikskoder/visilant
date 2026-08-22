# Visilant Browser Extension

## What is Visilant?

Visilant is a lightweight, cross-browser extension designed primarily to protect you from phishing sites that aim to steal your credentials by tricking you into voluntarily entering them, typically through visual similarity to legitimate websites.

The core idea is simple: most phishing websites are those you have never visited or visited very rarely. Unlike traditional antivirus solutions, Visilant's approach can immediately alert you about phishing sites – even those newly created and not yet included in any security blacklists or antivirus databases.

Visilant counts your visits to all websites and provides two layers of protection: **proactive** – analyzing links on the page before you click them, detecting URL mismatches and suspicious domains – and **reactive** – alerting you when you interact with an unfamiliar site (interaction types are customizable).

Note that the extension does not block any content. Its effectiveness relies entirely on your awareness and response to its visual cues.

## Real-Life Example: How Visilant Could Stop a Phishing Attack

Imagine you're exhausted after a long flight or simply distracted by everyday demands. You click on a link that seems to be from a trusted service. Without Visilant, you might inadvertently enter your credentials on a visually convincing fake site, unknowingly handing them over to attackers – just as cybersecurity expert Troy Hunt (creator of the [Have I Been Pwned](https://haveibeenpwned.com/) service) experienced in a recent [incident](https://www.troyhunt.com/a-sneaky-phish-just-grabbed-my-mailchimp-mailing-list). Even if you’ve successfully identified phishing attempts in the past, a single moment of inattention can lead to a compromise – exactly why having a companion like Visilant is so vital. While Troy noted that his incident could have been prevented using passkeys, that solution depends on websites implementing passkey technology first – something many have yet to do. By contrast, Visilant provides immediate protection on any site without waiting for vendors to adopt new authentication methods. Its visual alerts serve as a critical prompt, helping you pause, reconsider, and verify a site’s authenticity, ultimately safeguarding your credentials.

## Key Features

### Link Safety – Proactive Link Analysis
Visilant can analyze links on a page before you navigate, giving you visibility into where each link leads and whether you've been there before. Some sites can cause harm the moment you open them – no login or interaction required – so knowing the destination beforehand is critical.

This is a significant step up over the original reactive-only approach: instead of warning you after you've already landed on an unfamiliar site and started typing, Visilant now surfaces the destination domain and its familiarity status *before* you click, so you can compare the link text against the actual target and catch impersonation attempts up front.

- **Link Tooltip**: Hovering over (or clicking, depending on your settings) any external link (i.e. pointing to a different domain than the current page) shows a compact tooltip with the destination domain, your visit count, and a familiarity indicator (familiar / unfamiliar / never visited). The tooltip trigger is configurable: hover (default) or click (prevents navigation until you choose to proceed – the safest option).
- **URL Mismatch Detection**: A classic phishing trick is making a link's visible text look like one domain (e.g. `paypal.com`) while the actual destination is completely different. Visilant detects this and shows a side-by-side comparison table with familiarity status and visit counts for both domains.
- **Punycode / Unicode Detection**: Domains containing non-Latin characters that visually resemble Latin ones (homograph attacks) are flagged, with the ASCII (punycode) representation displayed.
- **Shortened URL Detection**: Shortened links (bit.ly, t.co, etc.) hide the real destination – a classic trick in clone phishing. Visilant can resolve them to reveal where they actually lead. Three modes: off, on-demand (button in tooltip), or automatic. You can also display the full redirect chain, resolve arbitrary URLs (not just known shorteners), maintain your own list of shortener domains (marking any domain as a shortener on the fly), or configure remote shortener lists to augment the built-in list.
- **Navigation Intercept** (opt-in): When enabled, clicking a link to an unfamiliar site triggers a full-screen confirmation dialog before navigation proceeds. The dialog shows the destination domain, your visit history with it, any mismatch or punycode warnings, and the resolved real destination if the link uses a shortener. You can go back or continue at your discretion.
- **Context Menu Integration**: Right-clicking a link offers "Check domain safety", which opens the dashboard for that domain in a new tab, and "Check link safety", which shows the full dialog on the spot when the right-click trigger is the one you chose. Selected text has "Check selected text with Visilant", and an image has "Scan QR code with Visilant". The domain check is there whether or not Link Safety is enabled in settings.
- **Scope Control**: Link Safety can be active on all websites, only on specific domains (e.g. your email client), or everywhere except certain domains (e.g. your intranet).

### Address Analysis
Wherever an address is shown – the link tooltip, the intercept dialog, the popup, the check field – Visilant states what is notable about it. None of these is a verdict. They are facts about the address, shown next to your visit history so you can judge it yourself.

- **Structural markers**: credentials hidden in the authority (`https://paypal.com@evil.net`), a bare IP address in place of a name, a domain ending used as a subdomain (`paypal.com.evil.net`), unusually deep subdomain nesting, and a single label written in two alphabets at once. Each rests on how URLs and DNS work, so an attacker cannot avoid one without giving up the trick it enables.
- **Resemblance to sites you know**: an address that looks like a domain from *your own* visit history is called out – a swapped character (`pаypal.com` with a Cyrillic а), a digit standing in for a letter (`paypa1.com`), a typo (`payapl.com`), the familiar name padded out (`paypal-secure.com`, `googlesupport.com`), or a whole familiar domain parked in the subdomains. Because the comparison uses your history rather than a shipped list of brands, it differs for every user and an attacker cannot test a domain against it in advance. Strong matches are shown prominently, while weaker resemblances stay quiet so they never train you to dismiss the warning.
- **External lookups**: a collapsed list of links to third-party services – VirusTotal, urlscan.io and Google Safe Browsing out of the box. These are links, not integrations: no API keys, no rate limits, and nothing is requested until you click one. The list is editable in settings, one `Name = https://example.com/check/{domain}` per line, so you can point it at whatever you actually use.

### Email Addresses
The part after the @ is a domain like any other, so everything above applies to it – plus what is particular to mail:

- **Public services and disposable mail**: an address at a service anyone can register with is marked as one, so you judge the name before the @ rather than the domain, and a temp-mail domain is called out as itself. Both lists ship built in, take additions of your own, and can be topped up from a URL.
- **Where the mail is actually read**: nobody ever opens `gmail.com` – Gmail is read on `mail.google.com` – so an address domain collects no visits of its own, and its counter is a zero that can never move. Visilant maps the well-known providers to the mailbox their mail is read on and reports the visits from there. You can map anything the built-in table misses yourself.
- **Resemblance to a provider**: for addresses only, the well-known mail providers join your own history as something an address can be one letter away from. Ordinary browsing warnings keep comparing against your history and nothing else.

### Advanced Homograph Protection
Visilant employs several techniques to help you spot spoofed domains:
- **Domain Highlighting**: Marks the characters worth a second look – digits, separators, and anything outside the Latin alphabet. Latin letters are deliberately left unstyled: colouring them would read as a verdict on the ordinary part of an address and drown out the one character that matters.
- **Punycode Display**: Toggle between Unicode and Punycode (ASCII) formats to reveal internationalized domain attacks where characters look identical to Latin ones.
- **Secure Rendering**: Uses a specialized rendering component to prevent visual spoofing techniques.

### Interactive Popup Dashboard
Clicking the extension icon reveals a dashboard where you can:
- View visit statistics for the current domain and its subdomains.
- **Sort Sites**: Organize the list by visit count or name to better understand your history with a domain family.
- **Customize Display**: Toggle domain highlighting, change text case (uppercase/lowercase), switch Punycode modes, and adjust font size on the fly.
- **Per-Site Anti-Tampering Toggle**: See whether tamper detection is active for the current site and quickly disable or re-enable it without leaving the popup.
- **Check Anything by Hand**: A field opened from the popup takes a link, a bare domain, an email address or a QR code image – pasted, dropped or picked from disk – and reports the same facts as everything above. The same check is a right-click away on any selected text, and opens in the page you are already on.

### Theming & Responsive UI

- **Light / Dark / System Theme**: Pick a theme that suits your environment or follow your system preference.
- **Responsive Layout**: The popup and settings adapt to narrow widths – works when opened in a tab or on mobile-form-factor windows.

### Smart Detection
- **Local Resource Ignoring**: Visilant automatically ignores internal hosts (like `localhost` or intranet sites without dots in the hostname), preventing unnecessary alerts during development or local network usage.

### Hardened Security
Visilant implements multiple layers of protection to ensure reliable operation even on malicious sites:
- **Early Injection**: Content scripts load at `document_start`, before any page scripts can interfere.
- **Event Capturing**: All keyboard and clipboard events are intercepted in the capture phase, preventing malicious scripts from blocking them.
- **Anti-Tampering Protection**: A MutationObserver monitors the extension's DOM presence. If a malicious page attempts to remove Visilant's components, you'll receive an immediate system notification. The check can be disabled per-site (from the popup or via an exclusion list in settings) for trusted sites that heavily rebuild their page (e.g. some SPAs) and trigger false alarms.
- **Randomized DOM Footprint**: The extension container uses a randomly generated ID for each page load, making it harder for malicious scripts to detect Visilant's presence by querying specific element IDs.
- **Overlay Protection**: In-page warnings use maximum z-index and fixed positioning to prevent being hidden by page overlays.

## Getting Started:

1. **Install Visilant from your preferred browser's extension store:**

   - [Visilant for Chrome](https://chromewebstore.google.com/detail/visilant/cangpjiaklckllaeppbdhhpcmhjambak)
   - [Visilant for Firefox](https://addons.mozilla.org/en-GB/firefox/addon/visilant/)

2. Pin the Visilant icon to your browser toolbar for constant visibility (recommended due to [Script Injection Limitations](#limitations)). On Firefox for Android there is no toolbar to pin to – the icon, its colour and its counter are all there, under **Extensions** in the browser menu.

3. Click the Visilant icon to open the extension popup. It provides an overview of your visit history for the current site and allows quick access to display settings.

4. Click the Settings icon (gear) in the popup to open the full configuration page. Configure the extension according to your preferences:

   - **Familiarity rules**: Decide what makes a site "familiar", in a section of its own. Three checks are on offer, each with its own threshold: the number of **visits** (on by default, at 10), the number of **active days** – separate days you were there, which a single afternoon of clicking cannot fake – and how long the site has been **known**, counted in days since your first recorded visit. Switch on the ones you want and choose how many have to pass: all of them, any one of them, or a set number, such as two of three. Everything else the extension does follows from this one verdict.
     - **_Note:_** Active days and first-visit dates only exist for sites recorded since those fields were added, and a site without them cannot pass those checks. A history import fills them in for every site the browser still remembers – for anything older than that, or removed by a clearing of history, there is nothing left to read, and the settings page says which case you are in. On Firefox for Android there is no history to read at all, so the older records keep only their visit count and everything visited from now on carries both dates from its first visit.
   - **Toolbar icon**:

     - Choose whether the icon carries a counter, and what that counter shows: any one of the checks you have switched on, or how many of them the site passes. With a single check in use there is nothing to choose between, so the question is not asked.
     - Enable/disable icon color change to red for "unfamiliar" sites.

   - **Link safety**:

     - Link Safety is enabled by default. It analyzes external links on pages and shows a tooltip with the destination domain's familiarity status.
     - Choose the tooltip trigger: right-click (the default – nothing appears until you ask for it), left-click (safest – prevents navigation until you review), or hover, which waits out a delay of your choosing before it opens.
     - Configure visit count visibility in tooltips: always, never, only for unfamiliar sites, or only for familiar sites.
     - Optionally enable navigation intercept to require confirmation before visiting unfamiliar sites.
     - Configure shortened URL detection: off, on-demand button, or automatic. Optionally show the full resolved URL (not just the domain), display the redirect chain, resolve arbitrary URLs (not just known shorteners), or maintain your own list of custom shortener domains. You can also point the extension at remote shortener lists to keep the built-in list up to date.
     - Set the scope: all websites, only specific domains, or everywhere except certain domains.

   - **General**: Choose a light, dark, or system-matching theme, and decide whether the settings page explains itself. The explanations are on by default and worth keeping unless you know the settings by heart – switching them off only makes the page shorter.

   - **Email addresses**: Add to the built-in lists of public email services and disposable mail domains, keep either topped up from a URL, and map an address domain to the site its mail is read on.

   - **External lookups**: Edit the third-party services offered under a checked domain, one `Name = https://example.com/check/{domain}` per line. Clear the field for none at all.

   - **Anti-tampering**: List the sites where the tamper check should stay out of the way – ones that rebuild their page constantly and set it off for no reason.

   - **Notifications**:

     - Select notification triggers: typing, copying, or both (see [Notification Triggers](#notification-triggers) for details).
     - Select notification styles: browser notifications, in-page warnings, or both.
     - **Hold pastes on unfamiliar sites** (opt-in): instead of only warning you, the first paste on an unfamiliar site is stopped and nothing is inserted until you have looked at the address. Allowing it pastes nothing by itself – you press paste again and it goes through as an ordinary paste, and the page stops asking.
     - **_Note:_** When an in-page alert is displayed, you can disable further warnings for that specific site, whatever the familiarity rules say about it.
     - You can also disable notifications completely if you prefer a non-intrusive browsing experience. However, be sure to check the visit count on the extension icon during important interactions, as otherwise, the extension's effectiveness is greatly diminished.

   Every section carries a reset in its corner, which puts that section back to how it ships and leaves the rest of the page alone.

5. Your browser history is imported when Visilant is installed, so the counter starts with the sites you already know instead of treating every one of them as new. It reads every recorded visit, down to the date you first opened each site and the number of separate days you have been there. The import is read on the device and stays there – nothing is uploaded, and no site is contacted. It can be cancelled while it runs, resumes where it stopped, and the button in **Your data** re-runs it whenever you want.
     - **_Note:_** Dates are labelled "first known visit" because they can only reflect what is still in your browser history – clearing history removes visits that cannot be recovered.

### Notification Triggers

The extension triggers alerts (if enabled) only during specific interactions that phishing sites commonly exploit:

- **Keyboard Input or Content Paste**: Alerts trigger when credentials are typed or pasted into fields. Initially restricted to inputs, alpha testing showed many unconventional site implementations. Therefore, the extension now triggers alerts on any keystroke (excluding hotkeys) or paste event, striking a balance between intrusiveness and effectiveness.

- **Content Cutting or Copying**: Although less common in phishing attacks, this trigger was added after viewing YouTube [video](https://www.youtube.com/watch?v=Wm0kqSlyEjE) demonstrating a phishing exploit involving clipboard manipulation ([reCAPTCHA Phish](https://github.com/JohnHammond/recaptcha-phish)).

**_Note:_** File downloads aren't listed as dangerous interactions because humans typically detect suspicious downloads easily, and handling virus-infected files is best left to antivirus software. Visilant addresses a specific gap not covered by traditional antiviruses.

## Privacy Considerations

Visilant is open-source and operates locally within your browser:

- **All data remains on your computer.** Your visit counts, your history, and every check Visilant performs stay on your device. There is no server behind the extension, no account, and no telemetry. Every analysis described above – visit counts, structural markers, resemblance to sites you know – runs locally against data you already have.
- **Nothing is requested on your behalf without you asking.** Two features can cause a network request, and neither happens on its own:
  - **External lookups** offer links to third-party services. They are ordinary links, not integrations – Visilant sends nothing, and no service learns anything unless you choose to open it. Whichever one you open will, like any site you visit, see the domain you asked about and your IP address.
  - **Shortened link resolution** requests the shortened link itself to find out where it leads. On its default setting this happens only when you press the button in the tooltip, and you can disable it entirely or let it resolve automatically.
- **Remote lists** (URL shorteners, public email services, disposable mail domains) come with a maintained source filled in, and each is fetched only when you press Update in the settings. Clearing a field turns that source off, and any URL of your own can go in its place. Nothing is fetched on a schedule or in the background.
- The extension requests only the permissions necessary for proper operation:

  **Required permissions:**
  - **Tabs**: To detect the current website you're visiting and update the extension icon with visit count.
  - **Storage**: To save your visit history, settings, and preferences locally.
  - **ActiveTab**: To interact with the currently active tab when you click the extension icon.
  - **Notifications**: To display system alerts when anti-tampering protection detects malicious interference.
  - **Context Menus**: To add a "Check link safety" option to the right-click menu for links.
  - **Host permissions** (`*://*/*`): To inject content scripts that monitor keyboard and clipboard interactions and analyze links on all websites.
  - **Browser history**: To read your existing history once and turn it into per-hostname visit counts. An empty profile treats every site as unfamiliar, so without that first pass the extension warns about everything and reads as broken. It is decided once per profile: a fresh install imports, an update does so only if the profile holds no counts yet, and neither is repeated afterwards. The history is read in the browser and never leaves it. Only a visit count, a first and last date and a number of active days are kept per hostname, with no page addresses, no titles and no search terms. You can re-run or wipe the import yourself in the settings, under Your data.

  Firefox for Android has no history API. There the import cannot run at all, and
  the settings page says so instead of offering a button that would do nothing.

## Reproducible Builds

You do not have to take our word for what the store installed. Every release can
be rebuilt from this repository, byte for byte:

```bash
nix build github:ikskoder/visilant/v2.0.1#firefox
sha256sum result/*.xpi          # compare with SHA256SUMS on the release
```

`scripts/verify.sh <downloaded.xpi>` goes one step further and compares the copy
your browser actually installed with a fresh build, file by file. Release
archives also carry a Sigstore-signed provenance attestation tying them to the
commit and workflow that built them, and anyone can rerun the build in a fork
through the **reproduce** workflow.

Node, pnpm and every dependency are pinned through `flake.lock` and
`pnpm-lock.yaml`, and the archive is packed with fixed timestamps and sorted
entries, which is what makes two builds identical. Full instructions are in
[REPRODUCE.md](REPRODUCE.md).

## Limitations

While Visilant enhances awareness of "unfamiliar" websites, its limitations include:

- **Not a Malware Blocker**:
  Visilant doesn’t detect or block malicious code, downloads, or trackers. It focuses solely on tracking your visits to determine site familiarity. It's not a replacement for an antivirus, but an additional layer of protection in browser!

- **Relies on User Action**:
  Visilant issues warnings but does not enforce any protection. Ignoring these alerts leaves you vulnerable.

- **False Positives and Negatives**:
  Legitimate sites with low visit counts may trigger warnings (false positives), while phishing sites visited repeatedly may go unflagged (false negatives).

- **Compromised Trusted Sites**:
  If attackers gain control of a legitimate domain you've previously visited, Visilant won't detect it as suspicious since your visit history marks it as "familiar." However, at that point, you're likely facing a much larger security breach – such as a domain hijack or server compromise – where Visilant's lack of protection is the least of your concerns.

- **Partial Cross-Device Sync**:
  While your configuration settings are synced across devices (if you're logged into your browser), your visit history is stored locally to accommodate its size. This means a site marked as "familiar" on one computer will still be treated as "unfamiliar" on another until you visit it enough times there. Installing Visilant on that machine imports its history for you, which is what closes most of the gap – except on Firefox for Android, which does not let extensions read its history, so a phone starts from nothing and learns as you browse.

- **Script Injection Limitations**:
  To detect input and clipboard interactions, Visilant injects a small script into visited pages. While Visilant implements anti-tampering protection that detects removal attempts and notifies you via system notifications, it's still recommended to keep the extension icon in sight as an additional safeguard – pinned to the toolbar on desktop, or under Extensions in the menu on Firefox for Android.

Understanding these limitations is crucial for Visilant's effective use.

## Contributing & Feedback

Visilant is open source, and contributions are welcome, with some considerations:

- The developer's current workload may delay review of issues or pull requests.
- Please check existing issues before creating new ones.
- Pull requests adding third-party libraries should have strong justification.
- The developer reserves the right to reject pull requests deemed unsafe or misaligned with project goals.
