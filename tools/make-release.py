#!/usr/bin/env python3

# Builds the files of a Mobile-qbit release from a git tag:
#
#   mobile-qbit-<tag>.zip      the WebUI folder, for installing by hand
#   mobile-qbit-<tag>.torrent  the same files for the updater in the WebUI
#                              (Help → Check for updates)
#
# Usage:
#
#     python3 tools/make-release.py <tag> [--out DIR] [--webseed URL] [--repo DIR]
#
# The files are read from the git objects of the tag, not from the working
# tree, so they are byte for byte what raw.githubusercontent.com serves for
# that tag. The torrent relies on that: it has no trackers, and its only
# source is a web seed (BEP 19) on raw.githubusercontent.com. For a torrent
# with several files the client requests <web seed>/<torrent name>/<path>, so
# the torrent is named after the tag and the web seed is
# https://raw.githubusercontent.com/<owner>/<repo>/, which makes the URLs
# https://raw.githubusercontent.com/<owner>/<repo>/<tag>/private/index.html etc.
#
# The torrent is private (no DHT, PeX or local peer discovery), so updating
# doesn't announce anything to other peers.

import argparse
import hashlib
import json
import os
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# What the release contains. The .ts translation sources are left out, only
# the compiled .qm files are needed.
INCLUDED = ["private", "public", "translations", "README.md", "INSTALL.md"]
EXCLUDED_SUFFIXES = (".ts",)
PIECE_LENGTH = 64 * 1024


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


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def read_files(repo: Path, tag: str) -> list[tuple[str, bytes]]:
    """Returns [(path, content)] of the release files at the tag, sorted by path."""
    entries = []
    for entry in git(repo, "ls-tree", "-r", "-z", tag, "--", *INCLUDED).split(b"\0"):
        if not entry:
            continue
        meta, path = entry.split(b"\t", 1)
        mode, kind, sha = meta.split(b" ")
        path = path.decode()
        if kind != b"blob":
            continue
        if mode == b"120000":
            sys.exit(f"error: {path} is a symbolic link, qBittorrent refuses those in an alternative WebUI")
        if path.endswith(EXCLUDED_SUFFIXES):
            continue
        entries.append((path, sha.decode()))

    batch = subprocess.run(["git", "-C", str(repo), "cat-file", "--batch"], check=True, capture_output=True,
                           input=b"".join(f"{sha}\n".encode() for _, sha in entries)).stdout
    files = []
    offset = 0
    for path, sha in entries:
        header_end = batch.index(b"\n", offset)
        size = int(batch[offset:header_end].split(b" ")[2])
        files.append((path, batch[header_end + 1:header_end + 1 + size]))
        offset = header_end + 1 + size + 1
    return sorted(files)


def make_torrent(tag: str, files: list[tuple[str, bytes]], webseed: str, created: int) -> tuple[bytes, str]:
    """Returns the .torrent file and its info hash."""
    data = b"".join(content for _, content in files)
    pieces = b"".join(hashlib.sha1(data[i:i + PIECE_LENGTH]).digest() for i in range(0, len(data), PIECE_LENGTH))
    info = {
        "name": tag,
        "piece length": PIECE_LENGTH,
        "pieces": pieces,
        "private": 1,
        "files": [{"length": len(content), "path": path.split("/")} for path, content in files],
    }
    torrent = bencode({
        "comment": f"Mobile-qbit {tag}: WebUI files for the updater in Help → Check for updates",
        "created by": "Mobile-qbit tools/make-release.py",
        "creation date": created,
        "url-list": [webseed],
        "info": info,
    })
    return torrent, hashlib.sha1(bencode(info)).hexdigest()


def make_zip(path: Path, tag: str, files: list[tuple[str, bytes]], created: int) -> None:
    date_time = datetime.fromtimestamp(created, timezone.utc).timetuple()[:6]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files:
            info = zipfile.ZipInfo(f"Mobile-qbit-{tag}/{name}", date_time)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the release files of Mobile-qbit for a git tag.")
    parser.add_argument("tag", help="git tag of the release, e.g. v1.2.0")
    parser.add_argument("--out", type=Path, default=Path("dist"), help="output folder (default: dist)")
    parser.add_argument("--webseed", help="web seed URL (default: https://raw.githubusercontent.com/<repository>/,"
                                          " with the repository from private/version.json)")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="git repository (default: the one containing this script)")
    args = parser.parse_args()

    files = read_files(args.repo, args.tag)
    contents = dict(files)
    if "private/index.html" not in contents or "private/version.json" not in contents:
        sys.exit(f"error: {args.tag} has no private/index.html or private/version.json")

    version = json.loads(contents["private/version.json"])
    if args.tag != f"v{version['version']}":
        sys.exit(f"error: the tag {args.tag} doesn't match the version {version['version']} in private/version.json")

    # in GitHub Actions: make sure the updater will look for releases where they are published
    github_repository = os.environ.get("GITHUB_REPOSITORY", "")
    if github_repository and (github_repository.lower() != version["repository"].lower()) and not args.webseed:
        sys.exit(f"error: private/version.json names the repository {version['repository']}, but this is"
                 f" {github_repository}. Change \"repository\" in private/version.json.")

    webseed = args.webseed or f"https://raw.githubusercontent.com/{version['repository']}/"
    if not webseed.endswith("/"):
        sys.exit("error: the web seed URL must end with /")

    created = int(git(args.repo, "log", "-1", "--format=%ct", args.tag))
    args.out.mkdir(parents=True, exist_ok=True)

    torrent, info_hash = make_torrent(args.tag, files, webseed, created)
    torrent_path = args.out / f"mobile-qbit-{args.tag}.torrent"
    torrent_path.write_bytes(torrent)

    zip_path = args.out / f"mobile-qbit-{args.tag}.zip"
    make_zip(zip_path, args.tag, files, created)

    total = sum(len(content) for _, content in files)
    print(f"{len(files)} files, {total / 1_000_000:.1f} MB, web seed {webseed}")
    print(f"{torrent_path} (info hash {info_hash})")
    print(zip_path)


if __name__ == "__main__":
    main()
