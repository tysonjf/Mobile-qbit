#!/usr/bin/env python3

# Compiles the WebUI translation sources (translations/*.ts) into the binary
# Qt .qm files qBittorrent loads for an alternative WebUI. The translations of
# Mobile-qbit's own strings (translations/mobile/*.ts, see
# tools/update-translations.py) go into the same .qm files.
#
# This does what `lrelease -removeidentical` does for qBittorrent's WebUI
# translations, so Qt's tools are not needed. Usage:
#
#     python3 tools/build-translations.py [translations folder]
#
# The .qm format: a 16 byte magic number followed by tagged blocks. Only the
# blocks QTranslator needs are written: a sorted table of (hash, offset) pairs
# and the messages themselves.

import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

QM_MAGIC = bytes([0x3C, 0xB8, 0x64, 0x18, 0xCA, 0xEF, 0x9C, 0x95, 0xCD, 0x21, 0x1C, 0xBF, 0x60, 0xA1, 0xBD, 0xDD])

TAG_HASHES = 0x42
TAG_MESSAGES = 0x69

TAG_END = 1
TAG_TRANSLATION = 3
TAG_SOURCE_TEXT = 6
TAG_CONTEXT = 7
TAG_COMMENT = 8


def elf_hash(data: bytes) -> int:
    # same as elfHash() in qtranslator.cpp
    h = 0
    for byte in data:
        h = ((h << 4) + byte) & 0xFFFFFFFF
        g = h & 0xF0000000
        if g != 0:
            h ^= g >> 24
        h &= ~g & 0xFFFFFFFF
    return h if h != 0 else 1


def byte_array(tag: int, data: bytes) -> bytes:
    return struct.pack(">BI", tag, len(data)) + data


def encode_message(context: bytes, source: bytes, comment: bytes, translation: str) -> bytes:
    text = translation.encode("utf-16-be")
    return (struct.pack(">BI", TAG_TRANSLATION, len(text)) + text
            + byte_array(TAG_COMMENT, comment)
            + byte_array(TAG_SOURCE_TEXT, source)
            + byte_array(TAG_CONTEXT, context)
            + bytes([TAG_END]))


def read_messages(ts_path: Path):
    root = ET.parse(ts_path).getroot()
    for context in root.iter("context"):
        context_name = context.findtext("name", default="")
        for message in context.iter("message"):
            translation = message.find("translation")
            if (translation is None) or message.get("numerus") == "yes":
                continue
            if translation.get("type") in ("vanished", "obsolete"):
                continue

            source = message.findtext("source", default="")
            text = translation.text or ""
            # lrelease skips empty translations, -removeidentical the untranslated ones
            if (text == "") or (text == source):
                continue

            yield context_name, source, message.findtext("comment", default=""), text


def compile_ts(ts_paths, qm_path: Path) -> int:
    messages = bytearray()
    offsets = []
    seen = set()
    for context, source, comment, translation in (message for path in ts_paths for message in read_messages(path)):
        key = (context, source, comment)
        if key in seen:
            continue
        seen.add(key)

        source_bytes = source.encode("utf-8")
        comment_bytes = comment.encode("utf-8")
        offsets.append((elf_hash(source_bytes + comment_bytes), len(messages)))
        messages += encode_message(context.encode("utf-8"), source_bytes, comment_bytes, translation)

    hashes = b"".join(struct.pack(">II", h, offset) for h, offset in sorted(offsets))
    qm_path.write_bytes(QM_MAGIC + byte_array(TAG_HASHES, hashes) + byte_array(TAG_MESSAGES, bytes(messages)))
    return len(offsets)


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "translations"
    for ts_path in sorted(folder.glob("webui_*.ts")):
        mobile_path = folder / "mobile" / ts_path.name
        count = compile_ts([ts_path] + ([mobile_path] if mobile_path.exists() else []), ts_path.with_suffix(".qm"))
        print(f"{ts_path.with_suffix('.qm').name}: {count} translations")


if __name__ == "__main__":
    main()
