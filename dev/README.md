Development and testing
===

Everything needed to see Mobile-qbit working against a **real qBittorrent** and to
check changes on phone, tablet and desktop sizes. Nothing here is used by the WebUI
itself; qBittorrent only serves the `private`, `public` and `translations` folders.

Quick start
---

Needs `curl`, `python3`, Node.js with `pnpm`, and Chromium for Playwright.

```sh
cd dev
pnpm install                  # Playwright (in Claude Code cloud sessions a global copy is used too)
pnpm exec playwright install chromium   # not needed where browsers are preinstalled

# 1. start qbittorrent-nox 5.2.4 serving this repository (keep it running)
sh start-qbittorrent.sh       # http://127.0.0.1:8080, no login from localhost

# 2. in another shell: torrents, categories, tags and an offline search plugin
python3 make-test-data.py

# 3. screenshot tours (exit code 1 if anything failed)
node tour.js scenarios/main.json 390x844
node tour.js scenarios/views.json 390x844,844x390,1366x768
node tour.js scenarios/torrent-dialogs.json 390x844 "rename|delete"   # filter by name
SCHEME=dark node tour.js scenarios/options.json 390x844

# 4. look at the result
python3 contact-sheet.py sheet.png 5 0.4 .cache/shots/390x844/*.png
```

Everything (qbittorrent-nox binary, profile, downloads, screenshots) goes to
`dev/.cache`, which is ignored by git. Delete it to start from scratch.

`start-qbittorrent.sh` downloads a static `qbittorrent-nox` from
[userdocs/qbittorrent-nox-static](https://github.com/userdocs/qbittorrent-nox-static).
`QBT_RELEASE=release-5.2.4_v2.0.15` picks another release (see that project's
release list), `QBT_PORT=8081` another port. qBittorrent re-reads changed files, so
editing the WebUI and reloading the page (or re-running a tour) is enough.

In Claude Code cloud sessions, run the server as a background command with the
longest timeout. Background commands are stopped after their timeout; just start
it again (the profile and data are kept).

Scenario files
---

`scenarios/*.json` are arrays of `{ "name": ..., "steps": [...] }`; the step types
are documented at the top of [`tour.js`](tour.js). The groups:

| File | Covers |
| --- | --- |
| `main.json` | torrent list, menu, filters drawer, long press menu, selection mode, sort chips, details tabs |
| `torrent-dialogs.json` | add torrent (file / link), remove, limits, location, rename, categories, tags, trackers, peers, web seeds |
| `views.json` | Search (with results), search plugins, RSS, RSS Downloader, Log |
| `other-windows.json` | About, Statistics, Torrent Creator, Cookies, API key, logout |
| `options.json` | every tab of the Options window |

Sizes below 800px wide or 500px high are emulated as touch screens.

Checking that desktop didn't change
---

The desktop layout must stay identical to the stock WebUI. qBittorrent's built-in
WebUI (the unmodified 5.2.4 one) is the reference:

```sh
node tour.js scenarios/main.json 1366x768 && mv .cache/shots/1366x768 .cache/shots/mine
curl -X POST http://127.0.0.1:8080/api/v2/app/setPreferences --data-urlencode 'json={"alternative_webui_enabled":false}'
node tour.js scenarios/main.json 1366x768 && mv .cache/shots/1366x768 .cache/shots/stock
curl -X POST http://127.0.0.1:8080/api/v2/app/setPreferences --data-urlencode 'json={"alternative_webui_enabled":true}'
```

Then compare the two folders (e.g. with Pillow's `ImageChops.difference`). Only
live numbers (speeds, free space) may differ.

Things to know before changing the WebUI
---

* **Breakpoints.** The phone layout is
  `(width <= 767px), (pointer: coarse) and (height <= 500px)`. It is written in
  `private/css/mobile.css` and in `isMobileLayout()` of `private/scripts/mobile.js`;
  keep them in sync. The [README](../README.md#layout-breakpoints) lists all of them.
* **Inline styles.** MochaUI sizes columns, panels and windows with inline styles
  from JavaScript, so layout overrides often need `!important`.
* **Views bring their own `<style>`.** `views/*.html` are loaded into the main page
  after `mobile.css`, so rules for them are prefixed with `:root` to win (see the
  "tabs and windows" section of `mobile.css`). Some views also set heights from
  JavaScript (RSS Downloader).
* **Dialogs are iframes.** `private/*.html` dialog pages load `mobile.css` too, but
  inside an iframe a width media query measures the *iframe*: a 400px dialog on a
  desktop matches `width <= 767px`. Rules that must reach dialog content use
  `(pointer: coarse)`, and selectors for main page ids that dialogs reuse
  (`#error_div`, `#categorySelect`, `#torrentFilesFilterInput`, `#torrentFiles`) are
  scoped to their container.
* **Windows on phones** are sized by `fitWindowToViewport()` in `mobile.js`: big
  windows full screen, small ones centered and grown to fit their iframe content.
* **Touch events.** MooTools' `Drag` (column resize/reorder, window drag) also reacts
  to touch events, and browsers send emulated mouse events after a tap. Test taps,
  long presses and swipes, not only clicks.
* **Lists as cards.** `dynamicTable.js` puts `data-column` on every cell, and
  `mobile.css` turns rows into cards (torrents, search results, log). With the
  "virtual list" option rows have a fixed height (`TORRENT_CARD_HEIGHT` in
  `mobile.js`).
* **Strings.** New user-visible text uses `QBT_TR(text)QBT_TR[CONTEXT=...]`. Reuse
  strings that exist in `translations/*.ts` where possible (they are translated
  already); `python3 tools/build-translations.py` rebuilds the `.qm` files.
* **Checks before a PR** (from the repository root, after
  `pnpm install --shamefully-hoist`, see the [README](../README.md#development)):
  `npx eslint *.mjs private/*.html private/scripts/*.js private/views/*.html public/*.html public/scripts/*.js test/*/*.js`,
  `npx stylelint "**/*.css"`, `npx html-validate private public`,
  `npx prettier --check "**/*.css"` and `npx vitest run --dom`.

  The ESLint plugin is installed from a GitHub tarball. Where that download is
  blocked (HTTP 403, e.g. in Claude Code cloud sessions), clone it and install from
  the clone without committing the change to `package.json`:

  ```sh
  git clone --depth 1 --branch v1 https://github.com/Chocobo1/eslint-plugin-qbt-webui.git /tmp/eslint-plugin-qbt-webui
  sed -i 's#"https://github.com/Chocobo1/eslint-plugin-qbt-webui/tarball/v1"#"file:/tmp/eslint-plugin-qbt-webui"#' package.json
  CI=true pnpm install --shamefully-hoist
  git checkout package.json && rm -f pnpm-lock.yaml
  ```
