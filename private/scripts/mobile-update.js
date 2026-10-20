/*
 * MIT License
 * Copyright (C) 2026  Mobile-qbit contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/*
 * Updater of Mobile-qbit itself (Help → Check for WebUI updates).
 *
 * Checking: the latest release of the repository named in version.json is read
 * from the GitHub API. No token is used, so this only works for a public
 * repository.
 *
 * Installing: JavaScript in the browser can't write files on the computer that
 * runs qBittorrent, but qBittorrent can. Every release has a .torrent of the
 * WebUI files whose only source is a web seed on raw.githubusercontent.com
 * (see tools/make-release.py). The updater
 *  1. adds that torrent through the Web API with the save path
 *     <base>/versions, so the files land in a new folder <base>/versions/<tag>.
 *     Nothing is overwritten, and qBittorrent verifies every piece,
 *  2. removes the torrent from the transfer list when it is complete (the
 *     files stay),
 *  3. sets qBittorrent's alternative WebUI location to the new folder and
 *     checks that the new version is served. If it isn't, it switches back,
 *  4. deletes the previous version's folder if the updater made it,
 *  5. refreshes the scripts and styles the browser has cached, and reloads.
 * <base> is the folder Mobile-qbit was installed to.
 *
 * The release is trusted because the GitHub API names it, over HTTPS, as the
 * latest release of the repository in version.json.
 */

"use strict";

window.qBittorrent ??= {};
window.qBittorrent.MobileUpdate ??= (() => {
    const exports = () => {
        return {
            compareVersions: compareVersions,
            toPlainText: toPlainText,
            isCompatible: isCompatible,
            getInstallPaths: getInstallPaths,
            getInstalledVersion: getInstalledVersion,
            initWindow: initWindow,
            openWindow: openWindow
        };
    };

    const GITHUB_API = "https://api.github.com";
    const GITHUB_RAW = "https://raw.githubusercontent.com";
    const VERSIONS_FOLDER = "versions";
    // Tag of the torrents the updater adds, so they are easy to recognize
    const TORRENT_TAG = "Mobile-qbit update";
    // localStorage key: the version this browser last ran, see checkCachedVersion()
    const LAST_VERSION_KEY = "qbt_mobileQbitVersion";
    // Give up if the download makes no progress for this long
    const STALL_TIMEOUT = 120000;

    class UpdateError extends Error {}

    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

    /* Versions */

    const parseVersion = (version) => {
        return version.replace(/^v/, "").split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
    };

    // < 0 if a is older than b, 0 if they are the same, > 0 if a is newer
    const compareVersions = (a, b) => {
        const partsA = parseVersion(a);
        const partsB = parseVersion(b);
        for (let i = 0; i < Math.max(partsA.length, partsB.length); ++i) {
            const difference = (partsA[i] ?? 0) - (partsB[i] ?? 0);
            if (difference !== 0)
                return difference;
        }
        return 0;
    };

    // required: "major.minor" of qBittorrent a release is made for, e.g. "5.2"
    const isCompatible = (qbtVersion, required) => {
        const [major, minor] = parseVersion(qbtVersion);
        return `${major}.${minor}` === required;
    };

    // currentRoot: the alternative WebUI location qBittorrent uses now. If an
    // update installed it, it is <base>/versions/<installed tag>.
    const getInstallPaths = (currentRoot, installedTag, newTag) => {
        const separator = (currentRoot.includes("\\") && !currentRoot.includes("/")) ? "\\" : "/";
        const root = (currentRoot.length > 1) ? currentRoot.replace(/[/\\]+$/, "") : currentRoot;
        const managedSuffix = `${separator}${VERSIONS_FOLDER}${separator}${installedTag}`;
        const isManaged = root.endsWith(managedSuffix);
        const base = isManaged ? root.slice(0, -managedSuffix.length) : root;
        const versionsPath = `${base}${separator}${VERSIONS_FOLDER}`;
        return {
            currentRoot: root,
            isManaged: isManaged,
            versionsPath: versionsPath,
            newRoot: `${versionsPath}${separator}${newTag}`
        };
    };

    const fetchJson = async (url, options = {}) => {
        const response = await fetch(url, { cache: "no-store", ...options });
        if (!response.ok)
            throw new UpdateError(`${url}: HTTP ${response.status}`);
        return await response.json();
    };

    const getInstalledVersion = () => fetchJson("version.json");

    /* Web API helpers */

    const post = async (endpoint, params) => {
        const response = await fetch(`api/v2/${endpoint}`, {
            method: "POST",
            body: new URLSearchParams(params)
        });
        if (!response.ok && (response.status !== 409))
            throw new UpdateError(`${endpoint}: HTTP ${response.status} ${await response.text()}`);
        return response;
    };

    const getTorrent = async (hash) => {
        const torrents = await fetchJson(`api/v2/torrents/info?hashes=${hash}`);
        return torrents[0] ?? null;
    };

    // Lets qBittorrent download the .torrent file and returns its metadata
    const fetchMetadata = async (torrentUrl) => {
        const started = Date.now();
        while ((Date.now() - started) < 60000) {
            const response = await post("torrents/fetchMetadata", { source: torrentUrl });
            if (response.status === 200) {
                const metadata = await response.json();
                if (metadata.info !== undefined)
                    return metadata;
            }
            await sleep(1000);
        }
        throw new UpdateError("QBT_TR(qBittorrent couldn't download the release torrent %1.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", torrentUrl));
    };

    const addTorrent = async (torrentUrl, savePath, options) => {
        await post("torrents/add", {
            urls: torrentUrl,
            savepath: savePath,
            // otherwise Automatic Torrent Management may choose another save path
            autoTMM: false,
            // otherwise "Keep incomplete torrents in" may be used
            useDownloadPath: false,
            contentLayout: "Original",
            tags: TORRENT_TAG,
            ...options
        });
    };

    const waitForTorrent = async (hash) => {
        for (let i = 0; i < 30; ++i) {
            const torrent = await getTorrent(hash);
            if (torrent !== null)
                return torrent;
            await sleep(500);
        }
        throw new UpdateError(`Torrent ${hash} wasn't added`);
    };

    const removeTorrent = async (hash, deleteFiles) => {
        await post("torrents/delete", { hashes: hash, deleteFiles: deleteFiles });
        for (let i = 0; i < 30; ++i) {
            if (await getTorrent(hash) === null)
                return;
            await sleep(500);
        }
    };

    const setWebUIFolder = async (path) => {
        await post("app/setPreferences", {
            json: JSON.stringify({
                alternative_webui_enabled: true,
                alternative_webui_path: path
            })
        });
    };

    /* Browser cache */

    // qBittorrent lets browsers cache scripts and styles for 12 hours (images
    // for a week), and their URLs only change when qBittorrent restarts. After
    // an update the browser would keep running the old scripts. Requesting the
    // files with cache: "reload" replaces what the browser has cached.
    //
    // There is no list of what a browser has cached, so this follows the
    // references from index.html: the scripts, styles, images and pages it
    // refers to, what those refer to, and so on. Only files in the WebUI's own
    // folders and pages next to index.html count as references, and the
    // libraries in scripts/lib aren't searched.
    const REFERENCE_PATTERN = /["'`(]((?:\.\.\/)?(?:css|images|scripts|views)\/[\w./-]+\.(?:css|gif|html|ico|jpg|js|png|svg)|[\w-]+\.html)(\?[^"'`()\s]*)?/g;

    const refreshCache = async () => {
        const seen = new Set();
        const queue = [];
        const add = (url) => {
            if ((url.origin === location.origin) && !seen.has(url.href)) {
                seen.add(url.href);
                queue.push(url);
            }
        };

        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                const response = await fetch(url, { cache: "reload" }).catch(() => null);
                if (!response?.ok || !/\.(?:css|html|js)$/.test(url.pathname) || url.pathname.includes("/scripts/lib/"))
                    continue;

                const text = await response.text();
                for (const [, path, query = ""] of text.matchAll(REFERENCE_PATTERN)) {
                    if (query.includes("${"))
                        continue;
                    // url() in style sheets is relative to the style sheet, the
                    // rest to the page (views are loaded into the main page)
                    const base = url.pathname.endsWith(".css") ? url : document.baseURI;
                    add(new URL(path + query, base));
                }
            }
        };

        add(new URL("index.html", document.baseURI));
        // workers stop when the queue is empty, the last one finishes the rest.
        // (not Array.from(): MooTools replaces it with a version without mapFn)
        const workers = [];
        for (let i = 0; i < 6; ++i)
            workers.push(worker());
        await Promise.all(workers);
    };

    const setLastVersion = (version) => {
        try {
            localStorage.setItem(LAST_VERSION_KEY, version);
        }
        catch {
            // storage may be unavailable, e.g. in private browsing
        }
    };

    // Another browser (or another device) may have installed an update. When
    // this browser sees a new version for the first time, refresh what it may
    // have cached and reload.
    const checkCachedVersion = async () => {
        let lastVersion;
        try {
            lastVersion = localStorage.getItem(LAST_VERSION_KEY);
        }
        catch {
            return;
        }

        const { version } = await getInstalledVersion();
        if (lastVersion === version)
            return;

        setLastVersion(version);
        if (lastVersion === null)
            return;

        await refreshCache();
        location.reload();
    };

    /* Checking and installing */

    const state = {
        busy: false,
        installed: null,
        location: null,
        message: "",
        isError: false,
        progress: null,
        update: null
    };

    const getElement = (id) => document.getElementById(id);

    // Release notes are Markdown. They are shown as text, without the most
    // common markup.
    const toPlainText = (markdown) => {
        return markdown.replaceAll("\r\n", "\n")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^\s*[*-]\s+/gm, "• ")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    };

    const render = () => {
        const message = getElement("mobileUpdateMessage");
        if (message === null)
            return;

        message.textContent = state.message;
        message.classList.toggle("mobileUpdateError", state.isError);

        const progress = getElement("mobileUpdateProgress");
        progress.classList.toggle("invisible", (state.progress === null));
        progress.value = state.progress ?? 0;

        if (state.installed !== null)
            getElement("mobileUpdateInstalled").textContent = state.installed.version;
        if (state.location !== null)
            getElement("mobileUpdateLocation").textContent = state.location;

        const update = state.update;
        getElement("mobileUpdateCheck").disabled = state.busy;
        getElement("mobileUpdateInstall").disabled = state.busy || (update === null) || !update.canInstall;
        getElement("mobileUpdateInstall").classList.toggle("invisible", (update === null) || !update.isNewer);

        if (update === null)
            return;

        getElement("mobileUpdateLatest").textContent = update.latest.version;
        getElement("mobileUpdateRemoveOldRow").classList.toggle("invisible", !update.isNewer || !update.paths.isManaged);

        getElement("mobileUpdateNotesBox").classList.remove("invisible");
        getElement("mobileUpdateNotes").textContent = toPlainText(update.release.body ?? "");
        getElement("mobileUpdateReleaseLink").href = update.release.html_url;
        const zipLink = getElement("mobileUpdateZipLink");
        zipLink.classList.toggle("invisible", (update.zipUrl === null));
        zipLink.href = update.zipUrl ?? "";
    };

    const setStatus = (message, { isError = false, progress = null } = {}) => {
        state.message = message;
        state.isError = isError;
        state.progress = progress;
        render();
    };

    const getReleaseTorrentUrl = (release) => {
        const name = `mobile-qbit-${release.tag_name}.torrent`;
        return release.assets?.find((asset) => asset.name === name)?.browser_download_url ?? null;
    };

    const checkForUpdate = async () => {
        if (state.busy)
            return;

        state.busy = true;
        state.update = null;
        setStatus("QBT_TR(Checking for updates...)QBT_TR[CONTEXT=MobileUpdate]");
        try {
            // shown even if GitHub can't be asked
            const installed = await getInstalledVersion();
            const preferences = await fetchJson("api/v2/app/preferences");
            state.installed = installed;
            state.location = getInstallPaths(preferences.alternative_webui_path, `v${installed.version}`, "").currentRoot;
            render();

            let response;
            try {
                response = await fetch(`${GITHUB_API}/repos/${installed.repository}/releases/latest`, { cache: "no-store" });
            }
            catch {
                throw new UpdateError("QBT_TR(Couldn't reach GitHub. Check the internet connection of this device.)QBT_TR[CONTEXT=MobileUpdate]");
            }
            if (response.status === 404)
                throw new UpdateError("QBT_TR(GitHub doesn't list any release of %1. Either nothing was released yet, or the repository is private: GitHub only answers this check for public repositories.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", installed.repository));
            if ((response.status === 403) || (response.status === 429))
                throw new UpdateError("QBT_TR(GitHub allows only a few checks per hour. Please try again later.)QBT_TR[CONTEXT=MobileUpdate]");
            if (!response.ok)
                throw new UpdateError(`GitHub: HTTP ${response.status}`);
            const release = await response.json();

            const latest = await fetchJson(`${GITHUB_RAW}/${installed.repository}/${release.tag_name}/private/version.json`);
            const qbtVersion = await (await fetch("api/v2/app/version")).text();
            const isNewer = compareVersions(latest.version, installed.version) > 0;
            const torrentUrl = getReleaseTorrentUrl(release);
            const compatible = isCompatible(qbtVersion, latest.qbittorrent);

            state.update = {
                installed: installed,
                latest: latest,
                release: release,
                tag: release.tag_name,
                torrentUrl: torrentUrl,
                zipUrl: release.assets?.find((asset) => asset.name.endsWith(".zip"))?.browser_download_url ?? null,
                paths: getInstallPaths(preferences.alternative_webui_path, `v${installed.version}`, release.tag_name),
                isNewer: isNewer,
                canInstall: isNewer && compatible && (torrentUrl !== null)
            };

            if (!isNewer)
                setStatus("QBT_TR(Mobile-qbit is up to date.)QBT_TR[CONTEXT=MobileUpdate]");
            else if (!compatible)
                setStatus("QBT_TR(Version %1 is made for qBittorrent %2, but this is qBittorrent %3. Update qBittorrent first.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", latest.version).replace("%2", latest.qbittorrent).replace("%3", qbtVersion), { isError: true });
            else if (torrentUrl === null)
                setStatus("QBT_TR(Version %1 can't be installed from here. Download it from the release page.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", latest.version));
            else
                setStatus("QBT_TR(Version %1 is available.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", latest.version));
        }
        catch (error) {
            console.error(error);
            setStatus(error.message, { isError: true });
        }
        finally {
            state.busy = false;
            render();
        }
    };

    const downloadRelease = async (update) => {
        setStatus("QBT_TR(Downloading the release torrent...)QBT_TR[CONTEXT=MobileUpdate]");
        const metadata = await fetchMetadata(update.torrentUrl);
        if ((metadata.info.name !== update.tag) || !metadata.info.files.some((file) => file.path === `${update.tag}/private/index.html`))
            throw new UpdateError(`${update.torrentUrl} doesn't contain Mobile-qbit ${update.tag}`);

        // a previous attempt may have left the torrent behind
        const existing = await getTorrent(metadata.hash);
        if (existing !== null) {
            if (!existing.tags.split(",").map((tag) => tag.trim()).includes(TORRENT_TAG))
                throw new UpdateError("QBT_TR(The torrent of version %1 is already in the transfer list. Remove it and try again.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", update.latest.version));
            await removeTorrent(metadata.hash, false);
        }

        await addTorrent(update.torrentUrl, update.paths.versionsPath, {
            rename: `Mobile-qbit ${update.tag} (WebUI update)`,
            skip_checking: false,
            stopped: false,
            // the global "Torrent stop condition" could stop it before downloading
            stopCondition: "None",
            // start even if the download queue is full
            forced: true,
            // no share limits, their action could remove the files
            ratioLimit: -1,
            seedingTimeLimit: -1,
            inactiveSeedingTimeLimit: -1
        });
        await waitForTorrent(metadata.hash);

        try {
            await waitForDownload(update, metadata.hash);
        }
        catch (error) {
            // the files are incomplete, the next attempt starts over
            await removeTorrent(metadata.hash, true).catch(() => {});
            throw error;
        }

        // qBittorrent may still be renaming files (".!qB" extension)
        await sleep(1000);
        await removeTorrent(metadata.hash, false);
    };

    const waitForDownload = async (update, hash) => {
        // files matching "Excluded file names" are not downloaded
        const torrentFiles = await fetchJson(`api/v2/torrents/files?hash=${hash}`);
        const skipped = torrentFiles.filter((file) => file.priority === 0).map((file) => file.index);
        if (skipped.length > 0)
            await post("torrents/filePrio", { hash: hash, id: skipped.join("|"), priority: 1 });

        let lastProgress = -1;
        let lastProgressTime = Date.now();
        while (true) {
            const torrent = await getTorrent(hash);
            if (torrent === null)
                throw new UpdateError("QBT_TR(The update torrent was removed from the transfer list.)QBT_TR[CONTEXT=MobileUpdate]");
            if ((torrent.state === "error") || (torrent.state === "missingFiles"))
                throw new UpdateError("QBT_TR(qBittorrent couldn't write to %1. Make sure qBittorrent may write to that folder; its log tells the reason.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", update.paths.versionsPath));
            if ((torrent.progress >= 1) && ["uploading", "stalledUP", "forcedUP", "queuedUP", "stoppedUP"].includes(torrent.state))
                return;

            if (torrent.progress > lastProgress) {
                lastProgress = torrent.progress;
                lastProgressTime = Date.now();
            }
            else if ((Date.now() - lastProgressTime) > STALL_TIMEOUT) {
                throw new UpdateError("QBT_TR(The download stopped making progress. qBittorrent needs to reach raw.githubusercontent.com.)QBT_TR[CONTEXT=MobileUpdate]");
            }

            const percent = Math.floor(torrent.progress * 100);
            const speed = window.qBittorrent.Misc.friendlyUnit(torrent.dlspeed, true);
            setStatus(`QBT_TR(Downloading version %1...)QBT_TR[CONTEXT=MobileUpdate] ${percent}% (${speed})`.replace("%1", update.latest.version), { progress: torrent.progress });
            await sleep(1000);
        }
    };

    const switchToRelease = async (update) => {
        setStatus("QBT_TR(Switching to the new version...)QBT_TR[CONTEXT=MobileUpdate]", { progress: 1 });
        await setWebUIFolder(update.paths.newRoot);
        for (let i = 0; i < 20; ++i) {
            await sleep(500);
            const served = await getInstalledVersion().catch(() => null);
            if (served?.version === update.latest.version)
                return;
        }

        await setWebUIFolder(update.paths.currentRoot);
        throw new UpdateError("QBT_TR(qBittorrent didn't serve the new version from %1, so it uses the previous one again.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", update.paths.newRoot));
    };

    // Deletes the folder of the version that was just replaced, using the
    // torrent of its release: added without checking and removed with its files.
    const removePreviousVersion = async (update) => {
        const installedTag = `v${update.installed.version}`;
        const release = await fetchJson(`${GITHUB_API}/repos/${update.installed.repository}/releases/tags/${installedTag}`);
        const torrentUrl = getReleaseTorrentUrl(release);
        if (torrentUrl === null)
            throw new UpdateError(`${installedTag} has no torrent`);

        const metadata = await fetchMetadata(torrentUrl);
        if (metadata.info.name !== installedTag)
            throw new UpdateError(`${torrentUrl} doesn't contain Mobile-qbit ${installedTag}`);
        if (await getTorrent(metadata.hash) !== null)
            throw new UpdateError(`${installedTag} is in the transfer list`);

        await addTorrent(torrentUrl, update.paths.versionsPath, {
            skip_checking: true,
            stopped: true
        });
        await waitForTorrent(metadata.hash);
        await removeTorrent(metadata.hash, true);
    };

    const installUpdate = async () => {
        const update = state.update;
        if (state.busy || (update === null) || !update.canInstall)
            return;

        const question = "QBT_TR(Update Mobile-qbit to version %1?)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", update.latest.version);
        const details = "QBT_TR(qBittorrent will download it to %1 and use it as its WebUI.)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", update.paths.newRoot);
        if (!confirm(`${question}\n\n${details}`))
            return;

        state.busy = true;
        render();
        try {
            await downloadRelease(update);
            await switchToRelease(update);
            setLastVersion(update.latest.version);

            if (update.paths.isManaged && getElement("mobileUpdateRemoveOld")?.checked) {
                setStatus("QBT_TR(Deleting the previous version...)QBT_TR[CONTEXT=MobileUpdate]", { progress: 1 });
                await removePreviousVersion(update).catch((error) => {
                    console.error(error);
                });
            }

            setStatus("QBT_TR(Updated to version %1. Reloading...)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", update.latest.version), { progress: 1 });
            await refreshCache();
            location.reload();
        }
        catch (error) {
            console.error(error);
            const message = (error instanceof UpdateError) ? error.message : String(error);
            setStatus("QBT_TR(The update failed: %1)QBT_TR[CONTEXT=MobileUpdate]".replace("%1", message), { isError: true });
            state.busy = false;
            render();
        }
    };

    /* Window */

    const openWindow = () => {
        const id = "mobileUpdatePage";
        new MochaUI.Window({
            id: id,
            icon: "images/qbittorrent-tray.svg",
            title: "QBT_TR(Check for WebUI updates)QBT_TR[CONTEXT=MobileUpdate]",
            loadMethod: "xhr",
            contentURL: "views/mobileupdate.html?v=${CACHEID}",
            maximizable: false,
            padding: 10,
            width: 520,
            height: 400
        });
    };

    // Called by views/mobileupdate.html
    const initWindow = () => {
        getElement("mobileUpdateCheck").addEventListener("click", checkForUpdate);
        getElement("mobileUpdateInstall").addEventListener("click", installUpdate);
        render();
        if (!state.busy && (state.update === null))
            checkForUpdate();
    };

    const init = () => {
        if (window.self !== window.top)
            return;

        window.addEventListener("load", () => {
            document.getElementById("mobileUpdateLink")?.addEventListener("click", (event) => {
                event.preventDefault();
                openWindow();
            });
            setTimeout(() => {
                checkCachedVersion().catch((error) => {
                    console.error(error);
                });
            }, 3000);
        });
    };

    init();

    return exports();
})();
Object.freeze(window.qBittorrent.MobileUpdate);
