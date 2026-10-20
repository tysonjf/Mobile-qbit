#!/usr/bin/env python3

# A stand-in for GitHub to test the updater (Help → Check for updates) without
# publishing anything. It makes releases from the current working tree in
# dev/.cache/fake-github:
#
#   v<version>      the version in private/version.json: the "installed" one
#   v<version + 1>  and v<version + 2>: newer releases. They also set
#                   window.mobileQbitFakeRelease in mobile.js, so a test can
#                   tell which scripts the browser runs.
#
# and serves them like GitHub does:
#
#   /api/repos/<owner>/<repo>/releases/latest  like api.github.com, also
#   /api/repos/<owner>/<repo>/releases/tags/<tag>
#   /raw/<owner>/<repo>/<tag>/<path>           like raw.githubusercontent.com,
#                                              with Range requests (web seed)
#   /download/<tag>/<file>                     release files, like
#                                              github.com/<owner>/<repo>/releases/download
#   /control/latest/<tag>                      changes which release is the latest
#   /control/fail/<0|1>                        makes the web seed answer 404
#
# It also exports the installed version to dev/.cache/fake-github/install, the
# folder to use as qBittorrent's alternative WebUI for the test. The browser
# side (api.github.com, raw.githubusercontent.com) is redirected here by the
# "route" steps of scenarios/update.json; qBittorrent reaches this server
# directly because the fake releases' torrents name it as their web seed.
#
# Usage: python3 fake-github.py [--port 8098]

import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEV_DIR = Path(__file__).resolve().parent
REPO_DIR = DEV_DIR.parent
WORK_DIR = DEV_DIR / ".cache" / "fake-github"
CLONE_DIR = WORK_DIR / "repo"
DIST_DIR = WORK_DIR / "dist"
INSTALL_DIR = WORK_DIR / "install"
INCLUDED = ["private", "public", "translations", "README.md", "INSTALL.md"]


def git(*args: str, cwd: Path = CLONE_DIR, data: bytes | None = None) -> bytes:
    return subprocess.run(["git", "-c", "user.name=fake-github", "-c", "user.email=fake@example.org", *args],
                          cwd=cwd, check=True, capture_output=True, input=data).stdout


def bump(version: str, step: int) -> str:
    major, minor, patch = (int(part) for part in version.split("."))
    return f"{major}.{minor}.{patch + step}"


def make_releases(port: int) -> tuple[str, list[str]]:
    """Builds the fake releases. Returns the repository name and the tags, oldest first."""
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    CLONE_DIR.mkdir(parents=True)
    git("init", "-q")

    # the working tree, including changes that aren't committed yet
    files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *INCLUDED, cwd=REPO_DIR)
    for name in files.decode().split("\0"):
        if name and (REPO_DIR / name).is_file():
            target = CLONE_DIR / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_DIR / name, target)

    version_file = CLONE_DIR / "private" / "version.json"
    version = json.loads(version_file.read_text())
    tags = []
    for step in range(3):
        if step > 0:
            version["version"] = bump(version["version"], 1)
            version_file.write_text(json.dumps(version, indent=4) + "\n")
            with (CLONE_DIR / "private" / "scripts" / "mobile.js").open("a") as script:
                script.write(f'\nwindow.mobileQbitFakeRelease = "v{version["version"]}";\n')
        tag = f"v{version['version']}"
        git("add", "-A")
        git("commit", "-q", "-m", f"Release {tag}")
        git("tag", tag)
        tags.append(tag)

    webseed = f"http://127.0.0.1:{port}/raw/{version['repository']}/"
    for tag in tags:
        subprocess.run([sys.executable, str(REPO_DIR / "tools" / "make-release.py"), tag, "--repo", str(CLONE_DIR),
                        "--out", str(DIST_DIR), "--webseed", webseed], check=True)

    with tarfile.open(fileobj=io.BytesIO(git("archive", tags[0]))) as archive:
        archive.extractall(INSTALL_DIR, filter="data")
    return version["repository"], tags


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    repository = ""
    tags: list[str] = []
    latest = ""
    fail_webseed = False

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client closed the connection, e.g. a web seed request that is no longer needed

    def log_message(self, format, *args):
        if "/raw/" not in self.path:
            sys.stderr.write(f"{self.address_string()} {format % args}\n")

    def send(self, status: int, body: bytes, content_type: str = "application/octet-stream", headers: dict | None = None):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status: int, value):
        self.send(status, json.dumps(value, indent=2).encode(), "application/json")

    def release(self, tag: str) -> dict:
        base = f"http://127.0.0.1:{self.server.server_port}"
        notes = git("log", "-1", "--format=%B", tag).decode().strip()
        return {
            "tag_name": tag,
            "name": f"Mobile-qbit {tag}",
            "body": f"## What's changed\n\n* {notes} (fake release made by dev/fake-github.py)\n",
            "html_url": f"{base}/releases/tag/{tag}",
            "published_at": "2026-10-20T12:00:00Z",
            "prerelease": False,
            "assets": [{"name": path.name, "size": path.stat().st_size, "browser_download_url": f"{base}/download/{tag}/{path.name}"}
                       for path in sorted(DIST_DIR.glob(f"mobile-qbit-{tag}.*"))],
        }

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?", 1)[0])
        if match := re.fullmatch(r"/control/latest/(v[\w.-]+)", path):
            Handler.latest = match[1]
            return self.send_json(200, {"latest": Handler.latest})
        if match := re.fullmatch(r"/control/fail/([01])", path):
            Handler.fail_webseed = match[1] == "1"
            return self.send_json(200, {"fail": Handler.fail_webseed})
        if path == f"/api/repos/{self.repository}/releases/latest":
            return self.send_json(200, self.release(Handler.latest))
        if (match := re.fullmatch(rf"/api/repos/{self.repository}/releases/tags/(v[\w.-]+)", path)) and match[1] in self.tags:
            return self.send_json(200, self.release(match[1]))
        if match := re.fullmatch(r"/download/(v[\w.-]+)/([\w.-]+)", path):
            file = DIST_DIR / match[2]
            if match[1] in self.tags and file.is_file():
                return self.send(200, file.read_bytes())
        if path.startswith(f"/raw/{self.repository}/") and not Handler.fail_webseed:
            tag, _, name = path.removeprefix(f"/raw/{self.repository}/").partition("/")
            if tag in self.tags:
                try:
                    content = git("show", f"{tag}:{name}")
                except subprocess.CalledProcessError:
                    return self.send(404, b"Not Found", "text/plain")
                return self.send_range(content)
        self.send(404, b"Not Found", "text/plain")

    def send_range(self, content: bytes):
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if not match:
            return self.send(200, content, headers={"Accept-Ranges": "bytes"})
        start = int(match[1])
        end = min(int(match[2]) if match[2] else len(content) - 1, len(content) - 1)
        if start > end:
            return self.send(416, b"", headers={"Content-Range": f"bytes */{len(content)}"})
        self.send(206, content[start:end + 1], headers={"Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{end}/{len(content)}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve fake Mobile-qbit releases for testing the updater.")
    parser.add_argument("--port", type=int, default=8098)
    args = parser.parse_args()

    Handler.repository, Handler.tags = make_releases(args.port)
    Handler.latest = Handler.tags[1]
    print(f"releases {', '.join(Handler.tags)} (latest: {Handler.latest}), installed version: {INSTALL_DIR}")
    print(f"serving on http://127.0.0.1:{args.port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
