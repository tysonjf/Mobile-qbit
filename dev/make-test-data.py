#!/usr/bin/env python3

# Fills the qbittorrent-nox started by start-qbittorrent.sh with test data:
# torrents in various states (seeding, stalled, stopped, partially downloaded),
# categories, tags, web seeds, blocked IPs in the log and a dummy search plugin
# that returns results offline, and RSS feeds with articles.
# If a second qbittorrent-nox runs on port 8081 (the "peer", see dev/README.md),
# it slowly downloads a torrent from the first one, which then has a peer.
# It also writes an extra torrent file that is not added, for "Add torrent" tests.
# Running it again (e.g. after restarting qBittorrent, which forgets the log)
# skips the torrents and categories that exist already, and restarts the peer's
# download.
#
# Usage: python3 make-test-data.py [WebUI URL, default http://127.0.0.1:8080]

import hashlib
import http.server
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from email.utils import formatdate
from pathlib import Path

DEV_DIR = Path(__file__).resolve().parent
CACHE_DIR = DEV_DIR / ".cache"
DOWNLOADS_DIR = CACHE_DIR / "downloads"
TORRENTS_DIR = CACHE_DIR / "torrents"
API = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/") + "/api/v2"
PIECE_LENGTH = 65536

# name, files [(path, size)], content on disk: True (complete), False (missing) or "partial"
TORRENTS = [
    ("Ubuntu 24.04.1 Desktop amd64", [("ubuntu.iso", 900_000)], True, "Linux ISOs", ""),
    ("Big Buck Bunny (2008) 1080p", [("bbb.mkv", 700_000), ("bbb.srt", 20_000)], True, "Movies", "hd,favourite"),
    ("Debian 13 netinst", [("debian-netinst.iso", 400_000)], False, "Linux ISOs", ""),
    ("Sintel Open Movie Collection", [("sintel/sintel.mkv", 500_000), ("sintel/extras/making-of.mp4", 300_000), ("sintel/poster.jpg", 30_000)], True, "Movies", "hd"),
    ("Arch Linux 2026.10.01", [("archlinux.iso", 600_000)], False, "Linux ISOs", ""),
    ("Public Domain Audiobooks - A Very Long Torrent Name That Goes On And On To Test Truncation", [(f"book/ch{i:02d}.mp3", 40_000) for i in range(1, 13)], True, "Books", "archive"),
    ("Fedora Workstation 43 Live x86_64", [("fedora.iso", 800_000)], False, "Linux ISOs", ""),
    ("Wikipedia Dump Sample", [("enwiki.xml.bz2", 350_000)], True, "", "archive"),
    ("Tears of Steel 4K", [("tos.mov", 650_000)], "partial", "Movies", "hd"),
    ("LibreOffice 25.8 Portable", [("lo/setup.exe", 250_000), ("lo/readme.txt", 2_000)], True, "", ""),
]
STOPPED = {"Arch Linux 2026.10.01", "LibreOffice 25.8 Portable"}
# Peers for the "Blocked IPs" log: banned addresses (documentation ranges) and
# privileged ports, which qBittorrent refuses to connect to
BANNED_IPS = ["203.0.113.7", "198.51.100.23", "2001:db8::42"]
BLOCKED_PEERS = ["203.0.113.7:51413", "198.51.100.23:6881", "[2001:db8::42]:6881", "192.0.2.80:80", "192.0.2.81:443"]
# HTTP Sources tab; the servers don't exist
WEB_SEEDS = {"Sintel Open Movie Collection": ["https://download.example.org/sintel/",
                                              "https://mirror.example.net/pub/movies/open-movies/sintel/"]}
# The peer downloads this torrent from the first qbittorrent-nox at 1 KiB/s, which
# takes about 10 minutes
PEER_API = "http://127.0.0.1:8081/api/v2"
PEER_TORRENT = "Big Buck Bunny (2008) 1080p"
QBT_ADDRESS = "127.0.0.1:56881"
# RSS tab: feed path (folder\feed) and its articles (title, description). A local
# server on RSS_PORT serves the feeds while this script runs; qBittorrent keeps
# the articles it fetched, so later refreshes of the feeds fail (rerun the script).
RSS_PORT = 8099
RSS_FEEDS = {
    "Linux ISOs": [
        ("Fedora Workstation 43 released", "<p>The new release brings GNOME 49 and a faster installer.</p>"
         "<ul><li>Kernel 6.17</li><li>Firefox 144</li><li>Python 3.14</li></ul>"),
        ("Debian 13.2 point release", "<p>This point release fixes security issues and a few serious problems.</p>"),
        ("Arch Linux 2026.10.01 ISO", "<p>The monthly ISO, with kernel 6.17.1.</p>"),
        ("Ubuntu 26.04 LTS beta: a fairly long article title that has to wrap on a phone",
         "<p>" + " ".join(["Testing images are available for every flavour. Please report bugs on Launchpad."] * 12)
         + "</p><p>The final release is planned for April.</p>"),
    ],
    "Videos\\Open Movies": [
        ("Sintel (2010) 4K remaster", "<p>The Blender Foundation published a 4K version of Sintel.</p>"),
        ("Tears of Steel: making of", "<p>Two hours of behind the scenes footage.</p>"),
        ("Big Buck Bunny 3D", "<p>Stereoscopic version, side by side.</p>"),
    ],
    "Videos\\Example Series": [
        (f"Example Series S01E{i:02d} 1080p WEB", f"<p>Episode {i} of the first season.</p>") for i in range(1, 9)
    ],
}
EXTRA_TORRENT = ("Example Series (2026) Complete 1080p WEB",
                 [(f"Season 1/Episode {i:02d} - A Fairly Long Episode Title.mkv", 300_000 + (i * 1000)) for i in range(1, 9)]
                 + [("Extras/Behind the scenes.mp4", 200_000), ("Subtitles/en.srt", 4_000), ("cover.jpg", 30_000)])


def bencode(value) -> bytes:
    if isinstance(value, int):
        return b"i%de" % value
    if isinstance(value, str):
        value = value.encode()
    if isinstance(value, bytes):
        return b"%d:%s" % (len(value), value)
    if isinstance(value, list):
        return b"l" + b"".join(bencode(v) for v in value) + b"e"
    if isinstance(value, dict):
        return b"d" + b"".join(bencode(k) + bencode(value[k]) for k in sorted(value)) + b"e"
    raise TypeError(value)


def make_torrent(name, files, write_content, file_name=None) -> Path:
    data = b""
    for path, size in files:
        content = random.randbytes(size)
        data += content
        if write_content:
            file_path = DOWNLOADS_DIR / name / path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            # "partial": only the first third of the data is correct
            if write_content == "partial":
                content = content[:size // 3] + bytes(size - (size // 3))
            file_path.write_bytes(content)

    pieces = b"".join(hashlib.sha1(data[i:i + PIECE_LENGTH]).digest() for i in range(0, len(data), PIECE_LENGTH))
    torrent = {
        "announce": "http://tracker.example.org:6969/announce",
        "announce-list": [["http://tracker.example.org:6969/announce"], ["udp://tracker.opentrackr.example:1337/announce"]],
        "comment": "Test torrent for Mobile-qbit",
        "info": {"name": name, "piece length": PIECE_LENGTH, "pieces": pieces,
                 "files": [{"length": size, "path": path.split("/")} for path, size in files]},
    }
    torrent_path = TORRENTS_DIR / (file_name or (name[:60] + ".torrent"))
    torrent_path.write_bytes(bencode(torrent))
    return torrent_path


def post(endpoint, fields=None, files=None, api=API):
    if files:
        boundary = uuid.uuid4().hex
        body = b""
        for key, value in (fields or {}).items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
        for key, path in files.items():
            body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{path.name}"\r\n'
                     "Content-Type: application/x-bittorrent\r\n\r\n").encode() + path.read_bytes() + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    else:
        body = urllib.parse.urlencode(fields or {}).encode()
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
    request = urllib.request.Request(api + endpoint, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request) as response:
        return response.read().decode()


def post_new(endpoint, fields=None, files=None) -> bool:
    """post() for adding something; False if it exists already (409 Conflict)"""
    try:
        post(endpoint, fields, files)
        return True
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise
        return False


def get(endpoint, api=API):
    with urllib.request.urlopen(api + endpoint) as response:
        return json.loads(response.read())


def add_blocked_peers() -> None:
    post("/app/setPreferences", {"json": json.dumps({"banned_IPs": "\n".join(BANNED_IPS),
                                                     "block_peers_on_privileged_ports": True})})
    torrent = next(t for t in get("/torrents/info") if t["state"] not in ("stoppedDL", "stoppedUP"))
    post("/torrents/addPeers", {"hashes": torrent["hash"], "peers": "|".join(BLOCKED_PEERS)})


def add_web_seeds() -> None:
    hashes = {torrent["name"]: torrent["hash"] for torrent in get("/torrents/info")}
    for name, urls in WEB_SEEDS.items():
        post("/torrents/addWebSeeds", {"hash": hashes[name],
                                       "urls": "|".join(urllib.parse.quote(url, safe="") for url in urls)})


def start_peer_download(torrent_path) -> bool:
    """False if no peer runs"""
    try:
        torrents = get("/torrents/info", PEER_API)
    except urllib.error.URLError:
        return False

    # start over, the previous download may be complete
    for torrent in torrents:
        post("/torrents/delete", {"hashes": torrent["hash"], "deleteFiles": "true"}, api=PEER_API)
    time.sleep(1)
    post("/torrents/add", {"dlLimit": "1024"}, {"torrents": torrent_path}, api=PEER_API)
    time.sleep(1)
    torrent = get("/torrents/info", PEER_API)[0]
    post("/torrents/addPeers", {"hashes": torrent["hash"], "peers": QBT_ADDRESS}, api=PEER_API)
    return True


def rss_feed_xml(path, articles) -> bytes:
    items = ""
    for number, (title, description) in enumerate(articles):
        link = f"https://news.example.org/{urllib.parse.quote(path)}/{number}"
        info_hash = hashlib.sha1(link.encode()).hexdigest()
        items += (f"<item><title>{title}</title><link>{link}</link><guid>{link}</guid>"
                  f"<pubDate>{formatdate(time.time() - (number * 86400) - 3600, usegmt=True)}</pubDate>"
                  f"<author>news@example.org (Example News)</author>"
                  f"<description><![CDATA[{description}]]></description>"
                  f'<enclosure url="magnet:?xt=urn:btih:{info_hash}&amp;dn={urllib.parse.quote(title)}"'
                  f' type="application/x-bittorrent"/></item>')
    return (f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{path}</title>'
            f"<link>https://news.example.org/</link><description>{path}</description>{items}</channel></rss>").encode()


def add_rss_feeds() -> None:
    feeds = {f"/{index}.xml": rss_feed_xml(path, articles) for index, (path, articles) in enumerate(RSS_FEEDS.items())}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = feeds.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("Content-Type", "application/rss+xml")
            self.end_headers()
            self.wfile.write(body or b"")

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", RSS_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        post("/app/setPreferences", {"json": json.dumps({"rss_processing_enabled": True,
                                                         "rss_refresh_interval": 1440})})
        for index, path in enumerate(RSS_FEEDS):
            if "\\" in path:
                post_new("/rss/addFolder", {"path": path.rsplit("\\", 1)[0]})
            post_new("/rss/addFeed", {"url": f"http://127.0.0.1:{RSS_PORT}/{index}.xml", "path": path})
            post("/rss/refreshItem", {"itemPath": path})

        def article_count() -> int:
            def count(item) -> int:
                if "articles" in item:
                    return len(item["articles"])
                return sum(count(child) for child in item.values() if isinstance(child, dict))
            return count(get("/rss/items?withData=true"))

        expected = sum(len(articles) for articles in RSS_FEEDS.values())
        for _ in range(30):
            if article_count() >= expected:
                break
            time.sleep(1)
        # some articles read, the others stay unread
        items = get("/rss/items?withData=true")
        first_feed = items["Linux ISOs"]
        for article in first_feed["articles"][2:]:
            post("/rss/markAsRead", {"itemPath": "Linux ISOs", "articleId": article["id"]})
    finally:
        server.shutdown()


def main() -> None:
    random.seed(42)
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    TORRENTS_DIR.mkdir(parents=True, exist_ok=True)

    for category in ("Movies", "Linux ISOs", "Books"):
        post_new("/torrents/createCategory", {"category": category})
    post("/torrents/createTags", {"tags": "hd,favourite,archive"})

    torrent_paths = {}
    for name, files, content, category, tags in TORRENTS:
        torrent_path = torrent_paths[name] = make_torrent(name, files, content)
        added = post_new("/torrents/add", {"category": category, "tags": tags, "stopped": str(name in STOPPED).lower()},
                         {"torrents": torrent_path})
        print(f"added {name}" if added else f"exists already: {name}")

    time.sleep(1)
    add_blocked_peers()
    print(f"blocked {len(BLOCKED_PEERS)} peers (Log → Blocked IPs)")
    add_web_seeds()
    print(f"added web seeds to {', '.join(WEB_SEEDS)} (HTTP Sources tab)")
    if start_peer_download(torrent_paths[PEER_TORRENT]):
        print(f"the peer downloads {PEER_TORRENT} for about 10 minutes (Peers tab)")
    else:
        print("no peer on port 8081, the Peers tabs stay empty (see dev/README.md)")

    extra = make_torrent(*EXTRA_TORRENT, write_content=False, file_name="extra-series.torrent")
    print(f"not added, for the add torrent dialog: {extra}")

    post("/search/installPlugin", {"sources": str(DEV_DIR / "search-plugin" / "dummytest.py")})
    time.sleep(2)
    print("installed the dummy search plugin")

    add_rss_feeds()
    print(f"added {len(RSS_FEEDS)} RSS feeds (RSS tab)")


if __name__ == "__main__":
    main()
