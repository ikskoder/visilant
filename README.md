# Visilant Browser Extension

## What is Visilant?

Visilant is a lightweight cross-browser extension that helps you recognize unfamiliar websites by tracking how often *you personally* visit them. Instead of blocking threats, it provides customizable warnings when you interact with sites rarely visited *by you* — helping you stay alert without unnecessary noise. Its effectiveness depends on your awareness and response to those alerts.

## How Does It Work?

Visilant keeps track of how many times *you personally* visit each website. The core idea is simple: while frequently visited websites are not necessarily safe, almost all phishing or malicious websites tend to be ones you've never (or rarely) visited before.

### Main Features:

1. **Visit Counter**: The extension counts how many times you visit each website.
2. **Safety Warnings**: The extension alerts you when you interact with websites that *you personally* have visited fewer times than your set safety threshold. You'll receive alerts in two key situations:
    * When you're about to type or paste information on a rarely-visited site.
    * When you copy content from a rarely-visited site.
3. **Visual Indicators**:
    * The extension icon can change color to red when you're on a site that you have visited only a few times. It does not turn green on frequently visited sites — instead, it retains its standard appearance to avoid giving a false sense of security.
    * A badge on the icon can show the number of times you've visited the current site.

## Why Is This Useful?

This extension helps you detect phishing attempts that exploit visual deception. These include:

- **Homograph Attacks**: URLs that look legitimate but use visually similar characters (e.g., "0" instead of "O").
- **Clone Phishing**: Fake copies of legitimate websites designed to steal your information.

By tracking your visit history, the extension highlights unfamiliar (therefore potentially dangerous) websites that may try to mimic trusted ones. However, Visilant is not an antivirus — it doesn't block threats directly. Its effectiveness depends entirely on your response to the warnings. If you ignore them, the protection it offers is essentially nullified.

## How to Use Visilant

### Getting Started:

1.  **Install Visilant from your preferred browser's extension store:**
    * [Visilant for Chrome](https://chromewebstore.google.com/detail/visilant/cangpjiaklckllaeppbdhhpcmhjambak)
    * [Visilant for Firefox](https://addons.mozilla.org/en-GB/firefox/addon/visilant/)
2.  (Recommended) Pin the Visilant icon to your browser toolbar so it's always visible.
3.  Click the Visilant icon to open the Settings page.
4.  Configure the extension to your preferences — select language, adjust visit thresholds, visual cues, and notification styles as needed.
5.  (Recommended) Import your browser history to initialize the visit counter with websites you've already visited. This helps reduce false positives and therefore avoid annoying warnings for sites *you personally* use regularly.

### Configuring Settings:

1. **Safety Threshold**: Set how many times *you need to have visited* a site for it to be considered "safe" (default is 10).
2. **Display Settings**:
    * Choose whether to show the visit counter on the extension icon.
    * Enable/disable the icon color change for risky sites.
3. **Notification Settings**:
    * Choose when to show warnings (when typing, copying, or both).
    * Select notification style (browser notifications, in-page warnings, or both).
    * You can also turn off notifications completely if you prefer a quieter Browse experience.
4. **Language Settings**: Choose between English, Russian, or Ukrainian.

### Daily Use:

- The extension works automatically in the background, counting your visits to websites.
- If you try to enter and/or copy information on a site that *you personally* have visited only a few times, the extension can show a warning (depending on your notification settings).
- You can dismiss warnings for specific sites you trust.

## Privacy Considerations

Visilant is open source and it works locally in your browser:

- Your browsing data stays on your computer.
- The extension doesn't send your data to any external servers.
- It only needs permissions to track tabs, access storage, and (optionally) view your browser history. Notification permission is only required if you choose to enable OS-native browser notifications.

## Limitations

While Visilant can improve your awareness of unfamiliar websites, it has several important limitations based on its design:

- **Not a Malware Blocker**: Visilant does not detect or block malicious code, downloads, or trackers. It only tracks how familiar *you* are with a site.
- **Assumes Visit History Reflects Trust**: The core assumption is that phishing sites are usually new to you — but this does not mean unfamiliar sites are always dangerous, or that familiar ones are always safe.
- **User-Dependent**: The extension does not enforce any action; if you ignore its warnings, it provides no protection.
- **No Shared Intelligence**: Visilant does not analyze URLs against external blacklists or reputation databases. Everything is based on your local visit history.
- **False Positives and Negatives**: Some legitimate sites may be flagged due to low visit count, while phishing sites you've visited many times before (if any) won't be flagged.
- **Script Injection Limitations**: To detect text entry, copy, and paste events, Visilant injects a small script into the pages you visit. If a malicious site removes this script from the DOM — which is unlikely but theoretically possible — the warning functionality will stop working. In such cases, the only remaining protection is the extension icon, which may display the number of visits and/or turn red depending on your settings.

Understanding these limitations is essential to using Visilant effectively as part of your broader Browse habits and security practices.

## Development Notes

This extension is built upon the [vitesse-webext](https://github.com/antfu-collective/vitesse-webext) template, selected for its robust foundation for creating cross-browser compatible extensions. As a consequence of utilizing this template, the project structure may contain files inherited from the template that are not strictly necessary for the extension's current functionality. These extraneous files have not yet been removed but may be pruned in future updates as development time permits.

During the initial development phase, AI assistance was utilized to accelerate the prototyping process. Subsequently, critical sections of the codebase have undergone manual review and refinement by the developer to address functional requirements and initial bugs.

However, users should be aware that some code duplication may still exist within the project. This reflects the developer's ongoing learning process within the specific domain of browser extension development. A comprehensive code review and further cleanup efforts are planned for the future, but due to current time constraints, a specific timeline for completion cannot be provided at this moment.

## Contributing & Feedback

Visilant is an open source project, and contributions are welcome. However, please note the following:

- The developer is currently very busy and may not be able to review issues or pull requests quickly.
- If you have questions or suggestions, please create a new issue — but first check existing ones to avoid duplicates.
- Pull requests that add third-party libraries to the extension's dependencies are discouraged unless there's a strong justification.
- The developer reserves the right to reject any pull request deemed unsafe or misaligned with the project's goals.
