#!/usr/bin/env python3

# Keeps the translation sources of Mobile-qbit's own strings up to date, like
# Qt's lupdate does for qBittorrent.
#
# The WebUI's strings are QBT_TR(text)QBT_TR[CONTEXT=...] in private/ and public/.
# Most of them come from qBittorrent and are translated in translations/webui_*.ts,
# which are kept as qBittorrent ships them. The strings Mobile-qbit adds are
# translated in translations/mobile/webui_*.ts instead, one file per language of
# translations/. This script adds the strings that are missing there (untranslated,
# type="unfinished") and lists the ones the code doesn't use anymore; delete those
# by hand if they are gone for good. tools/build-translations.py compiles both.
#
# Usage: python3 tools/update-translations.py [--check]
#   --check  change nothing, exit with 1 if strings are missing

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape

REPO_DIR = Path(__file__).resolve().parent.parent
TRANSLATIONS_DIR = REPO_DIR / "translations"
MOBILE_DIR = TRANSLATIONS_DIR / "mobile"
QBT_TR = re.compile(r"QBT_TR\((.*?)\)QBT_TR\[CONTEXT=([^\]]+)\]", re.DOTALL)


def used_strings() -> set:
    strings = set()
    for folder in ("private", "public"):
        for path in (REPO_DIR / folder).rglob("*"):
            if path.suffix in (".html", ".js"):
                for match in QBT_TR.finditer(path.read_text(encoding="utf-8")):
                    strings.add((match.group(2), match.group(1)))
    return strings


def read_ts(path: Path) -> dict:
    """{(context, source): (translation, type)}"""
    messages = {}
    for context in ET.parse(path).getroot().iter("context"):
        name = context.findtext("name", default="")
        for message in context.iter("message"):
            translation = message.find("translation")
            messages[(name, message.findtext("source", default=""))] = (
                (translation.text or "") if translation is not None else "",
                translation.get("type") if translation is not None else "unfinished")
    return messages


def write_ts(path: Path, language: str, messages: dict) -> None:
    lines = ['<?xml version="1.0" encoding="utf-8"?>', "<!DOCTYPE TS>", f'<TS version="2.1" language="{language}">']
    for context in sorted({context for context, _ in messages}):
        lines += ["<context>", f"    <name>{escape(context)}</name>"]
        for (_, source), (translation, kind) in sorted((key, value) for key, value in messages.items() if key[0] == context):
            type_attribute = f' type="{kind}"' if kind else ""
            lines += ["    <message>",
                      f"        <source>{escape(source, {chr(34): '&quot;', chr(39): '&apos;'})}</source>",
                      f"        <translation{type_attribute}>{escape(translation, {chr(34): '&quot;', chr(39): '&apos;'})}</translation>",
                      "    </message>"]
        lines.append("</context>")
    lines.append("</TS>")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    check = "--check" in sys.argv[1:]
    upstream = {key for key, (_, kind) in read_ts(TRANSLATIONS_DIR / "webui_en.ts").items() if kind not in ("vanished", "obsolete")}
    mobile_strings = used_strings() - upstream
    languages = sorted(path.stem.removeprefix("webui_") for path in TRANSLATIONS_DIR.glob("webui_*.ts"))

    missing_files = []
    unused = set()
    for language in languages:
        path = MOBILE_DIR / f"webui_{language}.ts"
        messages = read_ts(path) if path.exists() else {}
        unused |= set(messages) - mobile_strings
        missing = mobile_strings - set(messages)
        if not missing:
            continue
        missing_files.append(path.name)
        if not check:
            MOBILE_DIR.mkdir(exist_ok=True)
            for key in missing:
                messages[key] = ("", "unfinished")
            write_ts(path, language, messages)

    if missing_files:
        print(("missing strings in " if check else "added the missing strings to ") + ", ".join(missing_files))
    for context, source in sorted(unused):
        print(f"not used anymore: {context}: {source}")
    if check and missing_files:
        print("run python3 tools/update-translations.py")
        sys.exit(1)


if __name__ == "__main__":
    main()
