# Visilant Browser Extension

## What is Visilant?

Visilant is a lightweight, cross-browser extension designed primarily to protect you from phishing sites that aim to steal your credentials by tricking you into voluntarily entering them, typically through visual similarity to legitimate websites.

The core idea is simple: most phishing websites are those you have never visited or visited very rarely. Unlike traditional antivirus solutions, Visilant's approach can immediately alert you about phishing sites — even those newly created and not yet included in any security blacklists or antivirus databases.

Visilant counts your visits to all websites and provides two layers of protection: **proactive** — analyzing links on the page before you click them, detecting URL mismatches and suspicious domains — and **reactive** — alerting you when you interact with an unfamiliar site (interaction types are customizable).

Note that the extension does not block any content; its effectiveness relies entirely on your awareness and response to its visual cues.

## Real-Life Example: How Visilant Could Stop a Phishing Attack

Imagine you're exhausted after a long flight or simply distracted by everyday demands. You click on a link that seems to be from a trusted service. Without Visilant, you might inadvertently enter your credentials on a visually convincing fake site, unknowingly handing them over to attackers — just as cybersecurity expert Troy Hunt (creator of the [Have I Been Pwned](https://haveibeenpwned.com/) service) experienced in a recent [incident](https://www.troyhunt.com/a-sneaky-phish-just-grabbed-my-mailchimp-mailing-list). Even if you’ve successfully identified phishing attempts in the past, a single moment of inattention can lead to a compromise — exactly why having a companion like Visilant is so vital. While Troy noted that his incident could have been prevented using passkeys, that solution depends on websites implementing passkey technology first — something many have yet to do. By contrast, Visilant provides immediate protection on any site without waiting for vendors to adopt new authentication methods. Its visual alerts serve as a critical prompt, helping you pause, reconsider, and verify a site’s authenticity, ultimately safeguarding your credentials.

## Key Features

### Link Safety — Proactive Link Analysis
Visilant can analyze links on a page before you navigate, giving you visibility into where each link leads and whether you've been there before. Some sites can cause harm the moment you open them — no login or interaction required — so knowing the destination beforehand is critical.

- **Link Tooltip**: Hovering over (or clicking, depending on your settings) any external link (i.e. pointing to a different domain than the current page) shows a compact tooltip with the destination domain, your visit count, and a familiarity indicator (familiar / unfamiliar / never visited). The tooltip trigger is configurable: hover (default) or click (prevents navigation until you choose to proceed — the safest option).
- **URL Mismatch Detection**: A classic phishing trick is making a link's visible text look like one domain (e.g. `paypal.com`) while the actual destination is completely different. Visilant detects this and shows a side-by-side comparison table with familiarity status and visit counts for both domains.
- **Punycode / Unicode Detection**: Domains containing non-Latin characters that visually resemble Latin ones (homograph attacks) are flagged, with the ASCII (punycode) representation displayed.
- **Navigation Intercept** (opt-in): When enabled, clicking a link to an unfamiliar site triggers a full-screen confirmation dialog before navigation proceeds. The dialog shows the destination domain, your visit history with it, and any mismatch or punycode warnings. You can go back or continue at your discretion.
- **Context Menu Integration**: Right-clicking any link provides a "Check link safety" option that opens the extension's detailed popup view for that domain in a new tab — available regardless of whether Link Safety is enabled in settings.
- **Scope Control**: Link Safety can be active on all websites, only on specific domains (e.g. your email client), or everywhere except certain domains (e.g. your intranet).

### Advanced Homograph Protection
Visilant employs several techniques to help you spot spoofed domains:
- **Domain Highlighting**: Visually distinguishes the effective top-level domain (eTLD+1) from subdomains, making it easier to spot subtle tricks.
- **Punycode Display**: Toggle between Unicode and Punycode (ASCII) formats to reveal internationalized domain attacks where characters look identical to Latin ones.
- **Secure Rendering**: Uses a specialized rendering component to prevent visual spoofing techniques.

### Interactive Popup Dashboard
Clicking the extension icon reveals a dashboard where you can:
- View visit statistics for the current domain and its subdomains.
- **Sort Sites**: Organize the list by visit count or name to better understand your history with a domain family.
- **Customize Display**: Toggle domain highlighting, change text case (uppercase/lowercase), switch Punycode modes, and adjust font size on the fly.

### Smart Detection
- **Local Resource Ignoring**: Visilant automatically ignores internal hosts (like `localhost` or intranet sites without dots in the hostname), preventing unnecessary alerts during development or local network usage.

### Hardened Security
Visilant implements multiple layers of protection to ensure reliable operation even on malicious sites:
- **Early Injection**: Content scripts load at `document_start`, before any page scripts can interfere.
- **Event Capturing**: All keyboard and clipboard events are intercepted in the capture phase, preventing malicious scripts from blocking them.
- **Anti-Tampering Protection**: A MutationObserver monitors the extension's DOM presence. If a malicious page attempts to remove Visilant's components, you'll receive an immediate system notification.
- **Randomized DOM Footprint**: The extension container uses a randomly generated ID for each page load, making it harder for malicious scripts to detect Visilant's presence by querying specific element IDs.
- **Overlay Protection**: In-page warnings use maximum z-index and fixed positioning to prevent being hidden by page overlays.

## Getting Started:

1. **Install Visilant from your preferred browser's extension store:**

   - [Visilant for Chrome](https://chromewebstore.google.com/detail/visilant/cangpjiaklckllaeppbdhhpcmhjambak)
   - [Visilant for Firefox](https://addons.mozilla.org/en-GB/firefox/addon/visilant/)

2. Pin the Visilant icon to your browser toolbar for constant visibility (recommended due to [Script Injection Limitations](#limitations)).

3. Click the Visilant icon to open the extension popup. It provides an overview of your visit history for the current site and allows quick access to display settings.

4. Click the Settings icon (gear) in the popup to open the full configuration page. Configure the extension according to your preferences:

   - **Safety Threshold**: Specify how many visits classify a site as "familiar" (default is 10).
   - **Icon Settings**:

     - Choose to display the visit counter on the extension icon.
     - Enable/disable icon color change to red for "unfamiliar" sites.

   - **Link Safety Settings**:

     - Link Safety is enabled by default. It analyzes external links on pages and shows a tooltip with the destination domain's familiarity status.
     - Choose the tooltip trigger: hover (default) or click (safest — prevents navigation until you review).
     - Configure visit count visibility in tooltips: always, never, only for unfamiliar sites, or only for familiar sites.
     - Optionally enable navigation intercept to require confirmation before visiting unfamiliar sites.
     - Set the scope: all websites, only specific domains, or everywhere except certain domains.

   - **Notification Settings**:

     - Select notification triggers: typing, copying, or both (see [Notification Triggers](#notification-triggers) for details).
     - Select notification styles: browser notifications, in-page warnings, or both.
     - **_Note:_** When an in-page alert is displayed, you can disable further warnings for that specific site regardless of its visit count or threshold settings.
     - You can also disable notifications completely if you prefer a non-intrusive browsing experience. However, be sure to check the visit count on the extension icon during important interactions, as otherwise, the extension's effectiveness is greatly diminished.

5. Import your browser history to initialize the visit counter with previously visited sites. This helps reduce false positives and unnecessary warnings for "familiar" sites.

### Notification Triggers

The extension triggers alerts (if enabled) only during specific interactions that phishing sites commonly exploit:

- **Keyboard Input or Content Paste**: Alerts trigger when credentials are typed or pasted into fields. Initially restricted to inputs, alpha testing showed many unconventional site implementations. Therefore, the extension now triggers alerts on any keystroke (excluding hotkeys) or paste event, striking a balance between intrusiveness and effectiveness.

- **Content Cutting or Copying**: Although less common in phishing attacks, this trigger was added after viewing YouTube [video](https://www.youtube.com/watch?v=Wm0kqSlyEjE) demonstrating a phishing exploit involving clipboard manipulation ([reCAPTCHA Phish](https://github.com/JohnHammond/recaptcha-phish)).

**_Note:_** File downloads aren't listed as dangerous interactions because humans typically detect suspicious downloads easily, and handling virus-infected files is best left to antivirus software. Visilant addresses a specific gap not covered by traditional antiviruses.

## Privacy Considerations

Visilant is open-source and operates locally within your browser:

- All data remains on your computer — nothing is sent to external servers.
- The extension requests only the permissions necessary for proper operation:

  **Required permissions:**
  - **Tabs**: To detect the current website you're visiting and update the extension icon with visit count.
  - **Storage**: To save your visit history, settings, and preferences locally.
  - **ActiveTab**: To interact with the currently active tab when you click the extension icon.
  - **Notifications**: To display system alerts when anti-tampering protection detects malicious interference.
  - **Context Menus**: To add a "Check link safety" option to the right-click menu for links.
  - **Host permissions** (`*://*/*`): To inject content scripts that monitor keyboard and clipboard interactions and analyze links on all websites.

  **Optional permissions:**
  - **Browser history**: Required only if you choose to import your existing browsing history to initialize visit counts (recommended for reducing false positives).

## Limitations

While Visilant enhances awareness of "unfamiliar" websites, its limitations include:

- **Not a Malware Blocker**:
  Visilant doesn’t detect or block malicious code, downloads, or trackers; it focuses solely on tracking your visits to determine site familiarity. It's not a replacement for an antivirus, but an additional layer of protection in browser!

- **Relies on User Action**:
  Visilant issues warnings but does not enforce any protection. Ignoring these alerts leaves you vulnerable.

- **False Positives and Negatives**:
  Legitimate sites with low visit counts may trigger warnings (false positives), while phishing sites visited repeatedly may go unflagged (false negatives).

- **Compromised Trusted Sites**:
  If attackers gain control of a legitimate domain you've previously visited, Visilant won't detect it as suspicious since your visit history marks it as "familiar." However, at that point, you're likely facing a much larger security breach — such as a domain hijack or server compromise — where Visilant's lack of protection is the least of your concerns.

- **Partial Cross-Device Sync**:
  While your configuration settings are synced across devices (if you're logged into your browser), your visit history is stored locally to accommodate its size. This means a site marked as "familiar" on one computer will still be treated as "unfamiliar" on another until you visit it enough times there. You can mitigate this by using the "Import History" feature on each new device to quickly populate the visit counter.

- **Script Injection Limitations**:
  To detect input and clipboard interactions, Visilant injects a small script into visited pages. While Visilant implements anti-tampering protection that detects removal attempts and notifies you via system notifications, it's still recommended to pin the extension icon to your toolbar as an additional safeguard.

Understanding these limitations is crucial for Visilant's effective use.

## Development Notes

This extension is built upon the [vitesse-webext](https://github.com/antfu-collective/vitesse-webext) template, chosen for its robust foundation in cross-browser compatibility. As a result, some unnecessary inherited template files remain. These may be removed in future updates.

During initial development, AI assistance accelerated prototyping. Subsequently, key code sections underwent manual review and refinement. Some code duplication may still exist due to the developer's ongoing learning in browser extension development. A thorough code review and cleanup are planned for future updates, subject to available time.

## Contributing & Feedback

Visilant is open source, and contributions are welcome, with some considerations:

- The developer's current workload may delay review of issues or pull requests.
- Please check existing issues before creating new ones.
- Pull requests adding third-party libraries should have strong justification.
- The developer reserves the right to reject pull requests deemed unsafe or misaligned with project goals.
