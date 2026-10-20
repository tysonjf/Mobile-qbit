#!/usr/bin/env python3

# Decides the version of the next release, for .github/workflows/release.yml,
# which runs it after every push to master:
#
#   - Nothing is released when private/, public/ and translations/ (what a
#     release ships) didn't change since the last release tag (vX.Y.Z).
#   - A version set by hand in private/version.json, higher than the last
#     release, is used as it is.
#   - Otherwise the last release's version goes up by the biggest --bump
#     (patch: 1.2.3 → 1.2.4, minor: → 1.3.0, major: → 2.0.0). Without a release
#     tag yet, the version in private/version.json goes up.
#
# Prints the new version (e.g. 1.3.0), or nothing when there is nothing to
# release.
#
# Usage: python3 tools/bump-version.py [--bump patch|minor|major ...] [--force] [--write]
#   --bump   one per merged pull request label; other values are ignored
#   --force  release even if nothing that ships changed
#   --write  write the new version to private/version.json

import argparse
import json
import re
import subprocess
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = REPO_DIR / "private" / "version.json"
SHIPPED = ["private", "public", "translations"]
BUMPS = ["patch", "minor", "major"]


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO_DIR), *args], check=True, capture_output=True, text=True).stdout


def parse(version: str) -> tuple:
    return tuple(int(part) for part in version.removeprefix("v").split("."))


def last_release_tag():
    tags = [tag for tag in git("tag", "--list", "v*", "--merged", "HEAD").split()
            if re.fullmatch(r"v\d+\.\d+\.\d+", tag)]
    return max(tags, key=parse, default=None)


def bumped(version: tuple, bump: str) -> tuple:
    major, minor, patch = version
    if bump == "major":
        return (major + 1, 0, 0)
    if bump == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Decide the version of the next release of Mobile-qbit.")
    parser.add_argument("--bump", action="append", default=[], help="patch, minor or major (the biggest one counts)")
    parser.add_argument("--force", action="store_true", help="release even if nothing that ships changed")
    parser.add_argument("--write", action="store_true", help="write the new version to private/version.json")
    args = parser.parse_args()

    data = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    current = parse(data["version"])
    tag = last_release_tag()
    if (tag is not None) and not args.force and (git("diff", "--name-only", tag, "HEAD", "--", *SHIPPED).strip() == ""):
        return

    if (tag is not None) and (current > parse(tag)):
        new = current
    else:
        bump = max((bump for bump in args.bump if bump in BUMPS), key=BUMPS.index, default="patch")
        new = bumped(parse(tag) if tag is not None else current, bump)

    version = ".".join(str(part) for part in new)
    if args.write and (new != current):
        data["version"] = version
        VERSION_FILE.write_text(json.dumps(data, indent=4) + "\n", encoding="utf-8")
    print(version)


if __name__ == "__main__":
    main()
