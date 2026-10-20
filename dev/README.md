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

#    optional, in another shell: a second qbittorrent-nox, a peer for the Peers tab
QBT_PROFILE=peer QBT_PORT=8081 QBT_BT_PORT=56882 sh start-qbittorrent.sh

# 2. in another shell: torrents, categories, tags, web seeds, blocked IPs, an
#    offline search plugin and RSS feeds; the peer starts downloading a torrent
#    from the first one
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

The peer (`QBT_PROFILE=peer`, profile and downloads in `.cache/peer`) downloads
*Big Buck Bunny* from the first qbittorrent-nox at 1 KiB/s, so for about 10 minutes
that torrent has a peer with progress and speeds. Run `make-test-data.py` again to
start over. Without the peer, the Peers tabs are empty.

The RSS feeds come from a server on port 8099 that only runs while
`make-test-data.py` does. qBittorrent keeps the articles it fetched; it marks a feed
red when a later refresh fails (e.g. after a restart). Running the script again
fetches them again. Opening articles marks them read, so the unread counts go down
with every tour.

Scenario files
---

`scenarios/*.json` are arrays of `{ "name": ..., "steps": [...] }`; the step types
are documented at the top of [`tour.js`](tour.js). The groups:

| File | Covers |
| --- | --- |
| `main.json` | torrent list, menu, filters drawer, long press menu (and what a long press may select), ⋮ button, selection mode, sort chips, details tabs (also at full height) |
| `torrent-dialogs.json` | add torrent (file / link, its file list as cards), remove, limits, location, rename, categories, tags, trackers, peers, web seeds |
| `views.json` | Search (with results, their download and ⋮ buttons), search plugins, RSS (feeds → articles → article), RSS Downloader, Log (General and Blocked IPs) |
| `other-windows.json` | About, Statistics, Torrent Creator, Cookies, API key, logout |
| `options.json` | every tab of the Options window |
| `update.json` | the updater (*Help → Check for WebUI updates*), needs `fake-github.py`, see below |

Sizes below 800px wide or 500px high are emulated as touch screens.
`REDUCED_MOTION=1 node tour.js ...` emulates *reduce motion*, and the `press` step
sends real key presses (`main.json` → `panels-keyboard` tests the keyboard access to
the menu panel and the filters drawer).

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

Testing the updater
---

The updater (`private/scripts/mobile-update.js`) talks to GitHub, which a test
shouldn't depend on. [`fake-github.py`](fake-github.py) stands in for it:

```sh
python3 fake-github.py        # keep it running, port 8098
node tour.js scenarios/update.json 390x844
```

On start it builds releases `v<version>`, `v<version + 1>` and `v<version + 2>` from
the working tree (uncommitted changes included) with `tools/make-release.py`, and
exports the first one to `.cache/fake-github/install`. The scenarios then

1. point qBittorrent at that folder (the "installed" version),
2. open the update window, with the browser's requests to `api.github.com` and
   `raw.githubusercontent.com` redirected to the fake server (`route` steps),
3. update twice. The second update also deletes the folder of the first one. The
   newer releases set `window.mobileQbitFakeRelease`, which shows that the browser
   really runs the new scripts after the reload,
4. point qBittorrent back at the repository.

qBittorrent itself downloads the releases from the fake server: their torrents name
it as the web seed. `http://127.0.0.1:8098/control/fail/1` makes the web seed fail
(the updater gives up after two minutes without progress), `/control/fail/0` ends
that, and `/control/latest/<tag>` changes which release is the latest one.

Restart `fake-github.py` to test changed code: it rebuilds everything, and deletes
`.cache/fake-github`, so make sure qBittorrent doesn't use a folder in there at that
moment (`update-restore` points it back at the repository).

Making a release
---

1. Set `"version"` in [`private/version.json`](../private/version.json) (for example
   `1.1.0`). If the release needs a different qBittorrent version, also update
   `"qbittorrent"` (major.minor, e.g. `5.3`); the updater only installs releases made
   for the running qBittorrent.
2. Commit, then tag and push:

   ```sh
   git tag v1.1.0
   git push origin v1.1.0
   ```

The [release workflow](../.github/workflows/release.yml) runs
[`tools/make-release.py`](../tools/make-release.py) and publishes a GitHub release
with:

* `mobile-qbit-v1.1.0.zip`: the WebUI folder, for installing by hand,
* `mobile-qbit-v1.1.0.torrent`: the same files for the updater. Its only source is a
  web seed on `raw.githubusercontent.com`, so the files are served straight from the
  tagged commit and qBittorrent verifies them against the torrent.

The workflow fails if the tag doesn't match `version.json`. Tags with a hyphen
(`v1.1.0-rc1`) become pre-releases, which the updater ignores. A fork must change
`"repository"` in `version.json`, as the updater looks for releases there.

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
* **Long press.** Chromium's emulation has no native long press: the `longpress`
  step only sends touch events, so it never selects text or opens the browser's own
  menu. Check the computed styles instead (see the `*long-press-text` scenarios).
  Safari has no `user-select`, only `-webkit-user-select`; `mobile.css` sets both
  on touch screens.
* **Lists as cards.** `dynamicTable.js` puts `data-column` on every cell, and
  `mobile.css` turns rows into cards (torrents, search results, log). With the
  "virtual list" option rows have a fixed height (`TORRENT_CARD_HEIGHT` in
  `mobile.js`).
* **MooTools replaces some built-ins.** For example `Array.from()` ignores its
  second (map) argument; use a loop or `.map()` instead.
* **Calling the Web API from scripts.** Without login (localhost), every request
  without the session cookie gets a new session, and some calls keep state per
  session (`torrents/fetchMetadata` caches the downloaded torrent there). Keep the
  cookie (`curl -c cookies -b cookies`, a cookie jar in Python).
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
