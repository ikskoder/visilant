# Every screen

A catalogue of every case the extension can draw, made up on purpose, for a person to look through. Most of these never come up in ordinary browsing: a link one letter off a bank you know, a short link that leads nowhere, an import cut short, a mailto with thirty recipients, a paste inside a payment frame. Each one is set up here from scratch and drawn in light, dark and at phone width, so after a change you can look through all of them and see whether everything still looks right.

Nothing is compared or asserted. It is not a test suite, the tests in `e2e/` are.

## Running it

| What | Command |
|---|---|
| Draw every case and write the catalogue | `just shots` (`just ss`) |
| Only some of them | `just shots -g popup`, `just shots --project=dark tooltip` (arguments go to Playwright, a bare word picks scenario files) |
| Everything at another text size (the popup's A- / A+, 80 to 150) | `SHOTS_SCALE=150 just shots popup check` |
| Draw them again after every change to `src/` | `just shots-watch` (`just sw`) |

Then open `.tmp/shots/index.html` in a browser. A full run draws about 340 cases three times each and takes a while, with three browsers at once. A filtered run is much quicker.

The terminal only counts. Anything that went wrong with a case is on its card.

## What the catalogue shows

- Contents on the left, by what you are looking at (on a web page, toolbar popup, check page, settings, welcome page, toolbar button) and then by topic (lookalikes, short links, email links…), with a count per topic. They follow the scroll: the topic you are in opens and the case you are on is marked. A search box (`/`) narrows everything to the cases whose name, title or note has the words. Tick boxes hide a column.
- One card per case: what it is, a note on how it comes about and what to look for, and the screen in `light` and `dark` on a 1280×800 desktop and on `phone`, a 400 px wide window with no mouse, which is how the extension sees a touchscreen. Pictures are never drawn larger than they were taken.
- A click on a picture opens it over the whole window with its title and note. `←` `→` go through the pictures, `↑` `↓` jump to the case before or after in the same column, `z` switches a shrunk picture to full size, `Esc` closes. The address bar remembers the picture, so a reload opens it again.
- `Copy name` on a card or in the full screen view (`c`) copies a line like `[shot tt-look-two-edits · dark] Lookalike: two letters different`, to paste into a message about that picture.
- A case that could not be drawn keeps its card, marked red with the reason, and gets a red dot in the contents. The screen the case waits for never appeared, which is usually a bug in the extension. A case skipped on purpose on one column says why (on a phone there is nothing to hover with).
- At the top: any view under `src/contentScripts/views`, `src/popup`, `src/options` or `src/welcome` that no case shows.

## Adding a case

The scenario files are tables. Add a row to the one for its surface, and if the name starts a new kind of case, a line to `SECTIONS` in `gallery.ts`: `tooltip.shot.ts`, `dialogs.shot.ts`, `popup-more.shot.ts`, `check.shot.ts`, `options.shot.ts`, or one of the broader `page`, `popup` and `pages` files. A row says what to seed, which settings to change, how to bring the screen up, and the `name`, `title` and `note` for the card. `name` is the file name of the picture and must be unique. List every view file the picture shows in `covers`, or the catalogue will say that view has no case.

## How it works

- `build.ts` copies the working tree into `.tmp/shots/build-src/` and builds the Chrome version there, so `extension/`, which may be loaded in your own browser or written by `pnpm dev`, is never touched. Uncommitted edits are included.
- `fixtures.ts` starts one Chromium per worker with the build loaded, and before every case wipes the profile back to a known state: no visits, no lists, default settings in the column's theme, and a finished history import dated 15 January 2026. Visit dates are written relative to today, so "days known" reads the same every day. Anything a case swapped inside the service worker through `patchWorker` is put back too. What the background caches in memory by itself (a followed short link, a family check) is not, so each case that follows a link uses an address of its own.
- `helpers.ts` holds the gestures: resting on a link, the context-menu items, a QR result, opening the popup as the toolbar would, and `workerFetch`, which decides what the service worker's network answers while it follows a short link, since nothing real is ever contacted.
- The in-page UI sits in a closed shadow root, which no locator can reach. Cases wait for its text through the DevTools protocol (`waitForUi`), press its buttons the same way (`clickUi`), and then take the picture. Each picture is retaken until two in a row agree, so a screen still settling is not caught halfway.
- The toolbar button cannot be photographed, so `toolbar.shot.ts` records the icon and badge the background actually set for each kind of site and lays them out on a page of their own.
- `gallery.ts` writes `index.html` from the pictures and Playwright's report, with `gallery.css` and `gallery-client.js` inlined into it. Its `SECTIONS` table puts each case under a topic by its picture name, and a name it does not know lands under Other. `progress-reporter.ts` is the count in the terminal.

## Limits

- It is desktop Chromium. The phone column catches layout that does not fit a narrow screen, and the touchscreen behaviour that follows from having no mouse, but nothing else Firefox for Android does differently.
- Fonts come from the container, so text may be drawn slightly differently from your own browser.
- Browser notifications and the browser's own context menu are drawn by the browser, not the page, and cannot be pictured.
- Not drawn yet: the paste dialog's "checking" state on the page itself (it needs the background to stall at the right moment), and an import running from the settings page with its progress bar.
