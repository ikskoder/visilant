# Visilant Browser Extension

## What is Visilant?

Visilant is a lightweight, cross-browser extension designed primarily to protect you from phishing sites that aim to steal your credentials by tricking you into voluntarily entering them, typically through visual similarity to legitimate websites.

The core idea is simple: most phishing websites are those you have never visited or visited very rarely. Unlike traditional antivirus solutions, Visilant's approach can immediately alert you about phishing sites — even those newly created and not yet included in any security blacklists or antivirus databases.

Visilant counts your visits to all websites and displays highly configurable visual cues when interaction with a "unfamiliar" site is detected (interaction types are also customizable), helping you stay alert.

Note that the extension does not block any content; its effectiveness relies entirely on your awareness and response to its visual cues.

## Real-Life Example: How Visilant Could Stop a Phishing Attack

Imagine you're exhausted after a long flight or simply distracted by everyday demands. You click on a link that seems to be from a trusted service. Without Visilant, you might inadvertently enter your credentials on a visually convincing fake site, unknowingly handing them over to attackers — just as cybersecurity expert Troy Hunt (creator of the [Have I Been Pwned](https://haveibeenpwned.com/) service) experienced in a recent [incident](https://www.troyhunt.com/a-sneaky-phish-just-grabbed-my-mailchimp-mailing-list). Even if you’ve successfully identified phishing attempts in the past, a single moment of inattention can lead to a compromise — exactly why having a companion like Visilant is so vital. While Troy noted that his incident could have been prevented using passkeys, that solution depends on websites implementing passkey technology first — something many have yet to do. By contrast, Visilant provides immediate protection on any site without waiting for vendors to adopt new authentication methods. Its visual alerts serve as a critical prompt, helping you pause, reconsider, and verify a site’s authenticity, ultimately safeguarding your credentials.

## Getting Started:

1. **Install Visilant from your preferred browser's extension store:**

   - [Visilant for Chrome](https://chromewebstore.google.com/detail/visilant/cangpjiaklckllaeppbdhhpcmhjambak)
   - [Visilant for Firefox](https://addons.mozilla.org/en-GB/firefox/addon/visilant/)

2. Pin the Visilant icon to your browser toolbar for constant visibility (recommended due to [Script Injection Limitations](#limitations)).

3. Click the Visilant icon to open the Settings page.

4. Configure the extension according to your preferences:

   - **Safety Threshold**: Specify how many visits classify a site as "familiar" (default is 10).
   - **Icon Settings**:

     - Choose to display the visit counter on the extension icon.
     - Enable/disable icon color change to red for "unfamiliar" sites.

   - **Notification Settings**:

     - Select notification triggers: typing, copying, or both (see [Notification Triggers](#notification-triggers) for details).
     - Select notification styles: browser notifications, in-page warnings, or both.
     - **_Note:_** When an in-page alert is displayed, you can disable further warnings for that specific site regardless of its visit count or threshold settings.
     - You can also disable notifications completely if you prefer a non-intrusive browsing experience. However, be sure to check the visit count on the extension icon during important interactions, as otherwise, the extension's effectiveness is greatly diminished.

5. Import your browser history to initialize the visit counter with previously visited sites. This helps reduce false positives and unnecessary warnings for "familiar" sites.

### Notification Triggers

The extension triggers alerts (if enabled) only during specific interactions that phishing sites commonly exploit:

- **Keyboard Input or Content Paste**: Alerts trigger when credentials are typed or pasted into fields. Initially restricted to inputs, alpha testing showed many unconventional site implementations. Therefore, the extension now triggers alerts on any keystroke (excluding hotkeys) or paste event, striking a balance between intrusiveness and effectiveness.

- **Content Cutting or Copying**: Although less common in phishing attacks, this trigger was added after viewing John Hammond's YouTube [video](https://www.youtube.com/watch?v=Wm0kqSlyEjE) demonstrating a phishing exploit involving clipboard manipulation ([reCAPTCHA Phish](https://github.com/JohnHammond/recaptcha-phish), intended for "EdyUkAYshuNaL PoRpoiSes only!!!11 🐬"). And by the way, watching John Hammond’s content inspired this extension’s creation, so thanks to him for his videos!

**_Note:_** File downloads aren't listed as dangerous interactions because humans typically detect suspicious downloads easily, and handling virus-infected files is best left to antivirus software. Visilant addresses a specific gap not covered by traditional antiviruses.

## Privacy Considerations

Visilant is open-source and operates locally within your browser:

- All data remains on your computer.
- Extension only needs permissions necessary for it to work properly; other permissions are optional:
  - **Browser history**: Required only if you choose to import it (recommended).
  - **Notifications**: Required only if you choose OS-native browser notifications.

## Limitations

While Visilant enhances awareness of "unfamiliar" websites, its limitations include:

- **Not a Malware Blocker**:
  Visilant doesn’t detect or block malicious code, downloads, or trackers; it focuses solely on tracking your visits to determine site familiarity. It's not a replacement for an antivirus, but an additional layer of protection in browser!

- **Relies on User Action**:
  Visilant issues warnings but does not enforce any protection. Ignoring these alerts leaves you vulnerable.

- **False Positives and Negatives**:
  Legitimate sites with low visit counts may trigger warnings (false positives), while phishing sites visited repeatedly may go unflagged (false negatives).

- **Script Injection Limitations**:
  To detect input and clipboard interactions, Visilant injects a small script into visited pages. If a malicious site removes this script from the DOM - which is unlikely but theoretically possible - warnings cease. In such cases, protection relies solely on the extension icon, emphasizing the importance of pinning it to the toolbar.

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
