Installing Mobile-qbit
===

Mobile-qbit replaces the look of qBittorrent's WebUI; it doesn't replace qBittorrent.
You install it once on the computer (or server) that runs qBittorrent, and every
browser that opens the WebUI (phone, tablet or desktop) gets the new interface.
Nothing needs to be built or installed on the phone.

* [Requirements](#requirements)
* [Step 1: download Mobile-qbit](#step-1-download-mobile-qbit)
* [Step 2: tell qBittorrent to use it](#step-2-tell-qbittorrent-to-use-it)
  * [qBittorrent desktop app (Windows, macOS, Linux)](#qbittorrent-desktop-app-windows-macos-linux)
  * [From the WebUI itself (any setup)](#from-the-webui-itself-any-setup)
  * [qbittorrent-nox without access to the WebUI (config file)](#qbittorrent-nox-without-access-to-the-webui-config-file)
  * [Docker](#docker)
* [Step 3: open it on your phone](#step-3-open-it-on-your-phone)
* [Updating](#updating)
* [Going back to the original WebUI](#going-back-to-the-original-webui)
* [Troubleshooting](#troubleshooting)

Requirements
---

* **qBittorrent 5.2.x** (desktop app or `qbittorrent-nox`). Mobile-qbit is based on
  the WebUI of qBittorrent 5.2.4 and talks to qBittorrent through its Web API, so
  other major versions may not work completely. Check yours in *Help → About*.
* The **Web UI enabled** in qBittorrent (see step 2).
* A recent browser on the phone: Safari (iOS) or Chrome / Firefox / Edge (Android).

Step 1: download Mobile-qbit
---

Put Mobile-qbit in a folder that will stay where it is: qBittorrent reads the files
from that folder every time the WebUI is opened.

**Option A, ZIP file** (easiest):

1. On the [repository page](https://github.com/tysonjf/Mobile-qbit) click
   **Code → Download ZIP**.
2. Unzip it, for example to `C:\Mobile-qbit` (Windows), `~/Mobile-qbit` (macOS,
   Linux) or `/opt/Mobile-qbit` (server).

   The ZIP contains a folder called `Mobile-qbit-master`. The folder you will select
   in step 2 is the one that directly contains the `private` and `public` folders:

   ```text
   Mobile-qbit-master/      <- select this folder
   ├── private/
   ├── public/
   ├── translations/
   └── README.md
   ```

**Option B, git** (makes updating a one-liner):

```sh
git clone https://github.com/tysonjf/Mobile-qbit.git
```

Step 2: tell qBittorrent to use it
---

Use whichever of the following matches your setup.

### qBittorrent desktop app (Windows, macOS, Linux)

1. Open the options:
   * Windows / Linux: **Tools → Options…**
   * macOS: **qBittorrent → Settings…** (or *Preferences…*)
2. Select the **Web UI** page.
3. Tick **Web User Interface (Remote control)** if it isn't ticked yet. Note the
   **Port** (8080 by default) and set a **Username** and **Password**.
4. Tick **Use alternative WebUI** and set **Files location** to the Mobile-qbit
   folder from step 1 (the one containing `private` and `public`).
5. Click **OK** (or **Apply**).

### From the WebUI itself (any setup)

If you already use the WebUI (for example with a headless `qbittorrent-nox` on a
server or NAS):

1. Open the WebUI in a browser and log in.
2. Open **Tools → Options** (the gear button), then the **WebUI** tab.
3. Tick **Use alternative WebUI** and type the path of the Mobile-qbit folder in
   **Files location**. It is a path *on the machine running qBittorrent*, e.g.
   `/opt/Mobile-qbit`.
4. Click **Save** at the bottom and reload the page.

### qbittorrent-nox without access to the WebUI (config file)

1. Stop qBittorrent (`systemctl stop qbittorrent-nox@youruser`, or however you
   run it). qBittorrent overwrites the file on exit, so edit it while it's stopped.
2. Open the configuration file, usually `~/.config/qBittorrent/qBittorrent.conf`
   (or `<profile>/qBittorrent/config/qBittorrent.conf` if you start it with
   `--profile`).
3. In the `[Preferences]` section add or change these lines:

   ```ini
   WebUI\AlternativeUIEnabled=true
   WebUI\RootFolder=/opt/Mobile-qbit
   ```

4. Start qBittorrent again.

### Docker

The folder has to be visible *inside* the container. With the popular
[linuxserver/qbittorrent](https://docs.linuxserver.io/images/docker-qbittorrent/)
image, add a volume for it:

```yaml
services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest # better: pin a 5.2.x tag, see Requirements
    volumes:
      - ./config:/config
      - ./downloads:/downloads
      - /opt/Mobile-qbit:/mobile-qbit:ro          # <- Mobile-qbit
    ports:
      - 8080:8080
```

Recreate the container (`docker compose up -d`), then use **`/mobile-qbit`** (the
path inside the container) as **Files location**, through the WebUI or by setting
`WebUI\RootFolder=/mobile-qbit` in `config/qBittorrent/qBittorrent.conf`.

Step 3: open it on your phone
---

1. Find the address of the computer running qBittorrent on your home network:
   * Windows: run `ipconfig` and look for **IPv4 Address** (e.g. `192.168.1.20`).
   * macOS: *System Settings → Network*, or run `ipconfig getifaddr en0`.
   * Linux: run `hostname -I`.
2. With the phone on the same Wi-Fi, open `http://192.168.1.20:8080` (your address
   and port) and log in.
3. Optional: add it to the home screen so it opens like an app. Safari: *Share →
   Add to Home Screen*. Chrome: *⋮ → Add to Home screen*.

If the page doesn't load, check that the WebUI's **IP address** setting is `*` (all
addresses) and that the computer's firewall allows the port.

To use it away from home, prefer a VPN such as [Tailscale](https://tailscale.com) or
WireGuard over opening the port on your router. If you do expose it, enable
**Use HTTPS instead of HTTP** in the WebUI settings and use a strong password.

Updating
---

* ZIP: download the new ZIP and replace the contents of your Mobile-qbit folder.
* git: run `git pull` inside the folder.

Then reload the WebUI. qBittorrent picks up changed files automatically; there's no
need to restart it.

Going back to the original WebUI
---

Untick **Use alternative WebUI** (desktop app, or *Options → WebUI* in the WebUI),
or set `WebUI\AlternativeUIEnabled=false` in the configuration file while
qBittorrent is stopped.

Troubleshooting
---

**I still see the old interface.**
Reload the page (on a phone, close the tab and open it again). If it's still the old
one, check that the setting was saved. qBittorrent's log (*View → Log* in the
desktop app, or the *Execution Log* tab of the WebUI) shows
`Using custom WebUI. Location: "…"` when the alternative WebUI is active.

**The page is blank, or shows "Unacceptable file type, only regular file is allowed".**
**Files location** points to the wrong folder. It must be the folder that *directly*
contains `private` and `public`. With the ZIP this is often one level deeper than
expected (`Mobile-qbit-master/Mobile-qbit-master`). `qbittorrent-nox` switches back
to its built-in WebUI by itself when it can't find the files.

**"Symlinks inside alternative UI folder are forbidden".**
qBittorrent refuses symbolic links inside the folder. Copy the files instead of
linking them.

**Some things don't work after updating qBittorrent.**
Mobile-qbit matches the Web API of qBittorrent 5.2. After a major qBittorrent update
check this repository for a matching version, or switch back to the original WebUI
in the meantime.

**The interface is in English although qBittorrent is set to another language.**
qBittorrent loads the translations from the `translations` folder of Mobile-qbit.
Make sure that folder exists next to `private` and `public` and contains the `.qm`
files, then reload.

**I can't reach the settings any more to switch back.**
Use the desktop app's *Tools → Options → Web UI*, or edit the configuration file as
described in [Going back to the original WebUI](#going-back-to-the-original-webui).
