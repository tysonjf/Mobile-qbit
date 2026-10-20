Mobile-qbit
===

The default qBittorrent WebUI (from qBittorrent **v5.2.4**), made responsive so it
works on phones and tablets as well as on desktop browsers.

On a big screen it looks and behaves exactly like the stock WebUI. Below 768px
wide (phones in portrait, or phones in landscape) it switches to a touch friendly
layout:

| Torrents | Menu | Filters | Long press |
| :---: | :---: | :---: | :---: |
| ![Torrent list](docs/screenshots/torrents.png) | ![Menu](docs/screenshots/menu.png) | ![Filters drawer](docs/screenshots/filters.png) | ![Torrent actions](docs/screenshots/actions.png) |

| Details | Options |
| :---: | :---: |
| ![Torrent details](docs/screenshots/details.png) | ![Options](docs/screenshots/options.png) |

What changes on a phone:

* **Menu** button (☰) opens File / Edit / View / Tools / Help as a drop-down panel.
* **Filter** button opens the status / category / tag / tracker filters as a drawer.
  Picking a filter closes it again.
* The toolbar is a single row you can swipe sideways. Transfers / Search / RSS / Log
  tabs sit next to the menu buttons.
* Torrents are shown as **cards** (name, progress, status, size, ratio, ETA, speeds).
  The column headers become a row of **sort buttons**: tap one to sort, tap again to
  reverse.
* **Long press** a torrent (or a filter, tracker, peer, file, RSS item, ...) for its
  context menu, shown as a bottom sheet. Entries with a ▾ expand in place.
* Tap a torrent, then tap **General / Trackers / Peers / HTTP Sources / Content** to
  open its details. Tap the open tab again (or the arrow on the right) to close them.
* Every dialog fits the screen: big ones (Options, Add torrent, RSS Downloader, ...)
  open full screen, small prompts are centered and grow to fit their content.
* The Options window, Search, RSS, RSS Downloader, Log and all other dialogs reflow
  for narrow screens; text fields use a 16px font so iOS doesn't zoom in.
* Search results and log messages are cards too; light and dark themes both work.

Installing
---

The WebUI is used as qBittorrent's *alternative WebUI*. Nothing needs to be built.

1. On the computer running qBittorrent, download this repository
   (**Code → Download ZIP** on GitHub, then unzip it) or clone it:

   ```sh
   git clone https://github.com/tysonjf/Mobile-qbit.git
   ```

   Pick a permanent location; qBittorrent serves the files straight from that folder.

2. In qBittorrent open **Tools → Options → Web UI** (on macOS: *qBittorrent →
   Preferences → Web UI*):
   * make sure **Web User Interface (Remote control)** is enabled,
   * tick **Use alternative WebUI**,
   * set **Files location** to the folder you just downloaded (the one that contains
     the `private` and `public` folders, e.g. `C:\Users\you\Mobile-qbit` or
     `/home/you/Mobile-qbit`),
   * click **OK** / **Apply**.

   The same setting is also available in the WebUI itself: *Options → WebUI → Use
   alternative WebUI*.

3. Open `http://<your-pc-ip>:<port>` (port 8080 by default) on your phone and log in.
   If the browser shows the old page, reload it once.

To update later, replace the folder with the new version (or `git pull`) and reload
the page. To go back to the built-in WebUI, untick **Use alternative WebUI**.

> [!NOTE]
> The WebUI talks to qBittorrent through its Web API, so use it with
> **qBittorrent 5.2.x**. Older or much newer versions may have API differences.
> You can check your version in *Help → About*.

> [!NOTE]
> qBittorrent loads translations of an alternative WebUI from the WebUI folder, and
> only the translation sources (`translations/*.ts`) are included here. The WebUI is
> therefore shown in English, whatever language qBittorrent is set to.

Layout breakpoints
---

All responsive rules are media queries in [`private/css/mobile.css`](private/css/mobile.css),
which is loaded last by the main page and by every dialog page:

| Media query | Applies to | What it does |
| --- | --- | --- |
| `(width <= 767px), (pointer: coarse) and (height <= 500px)` | phones, portrait and landscape | phone layout |
| `(600px <= width) and (height <= 500px)` (within the phone layout) | phones in landscape | toolbar shares the top row with the tabs |
| `(width <= 479px)` | small phones | only the selected main tab shows its name |
| `(width <= 1100px)` | tablets, small laptops | narrower filter box and status bar |
| `(pointer: coarse)` | any touch screen | bigger menu, list and tab hit targets |
| `(hover: none)` | touch-only screens | no "sticky" hover highlight after a tap |

The login page has its own media queries in [`public/css/login.css`](public/css/login.css).

Changes compared to the stock WebUI
---

The first commit of this repository is the unmodified WebUI of qBittorrent v5.2.4
(`src/webui/www`), so `git diff` against it shows every change. In short:

* `private/css/mobile.css` (new): all responsive styles.
* `private/scripts/mobile.js` (new): menu button, filters drawer, fitting MochaUI
  windows into the screen, card row height for the virtual list option.
* `private/index.html`: menu/filter buttons, a wrapper around the toolbar buttons,
  loads `mobile.css` and `mobile.js`.
* `private/*.html` dialog pages: load `mobile.css`.
* `private/scripts/contextmenu.js`: bottom sheet mode; fixes the position of
  long-press menus on touch screens (touch events have no `pageX`/`pageY`).
* `private/scripts/dynamicTable.js`: cells get a `data-column` attribute (used by the
  card layouts); a row is selected on long press instead of on every touch, so
  scrolling the list no longer changes the selection.
* `private/scripts/client.js`: the details panel starts collapsed on phones, panel
  sizes of the phone layout are not saved over the desktop ones.
* `public/css/login.css`: responsive login page.
* `private/images/mobile-menu.svg`, `private/images/mobile-filter.svg` (new).

Development
---

The lint setup is the one of qBittorrent's WebUI:

```sh
pnpm install --shamefully-hoist   # eslint.config.mjs imports packages that npm hoists
pnpm run lint                     # eslint, stylelint and html-validate
pnpm run format                   # js-beautify and prettier
pnpm run test                     # vitest
```

To try changes, point qBittorrent's *alternative WebUI* at your working copy; files
are re-read when they change, so a page reload is enough.

Browser compatibility
---

Same as upstream: the latest stable release is the upper bound.

| Browser           | Lower bound                                            |
| ----------------- | ------------------------------------------------------ |
| Chrome            | [The release from 1 year ago][Chrome-lower-bound-link] |
| Firefox           | [Latest active ESR release][Firefox-ESR-link]          |
| Microsoft Edge    | [The release from 1 year ago][MSEdge-lower-bound-link] |
| Safari            | [The release from 1 year ago][Safari-lower-bound-link] |

[Supported browsers table](https://browsersl.ist/?results#q=Chrome+%3E+0+and+last+1+year%0AEdge+%3E+0+and+last+1+year%0AFirefox+ESR%0ASafari+%3E+0+and+last+1+year)

[Chrome-lower-bound-link]: https://browsersl.ist/?results#q=Chrome+%3E+0+and+last+1+year
[Firefox-ESR-link]: https://browsersl.ist/?results#q=Firefox+ESR
[MSEdge-lower-bound-link]: https://browsersl.ist/?results#q=Edge+%3E+0+and+last+1+year
[Safari-lower-bound-link]: https://browsersl.ist/?results#q=Safari+%3E+0+and+last+1+year

License
---

The WebUI is part of [qBittorrent](https://github.com/qbittorrent/qBittorrent) and is
licensed under the GPL-2.0-or-later license with the OpenSSL exception (individual
scripts carry their own MIT or GPL headers). MochaUI and MooTools are MIT licensed.
