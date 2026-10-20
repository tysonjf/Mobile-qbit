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

import { expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Mobile-qbit's own strings need entries in translations/mobile/*.ts, see
// tools/update-translations.py

const repoDir = join(import.meta.dirname, "..", "..");

const unescapeXml = (text) => text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

// "context|source" of the messages of a .ts file
const readTs = (path, withVanished = true) => {
    const keys = new Set();
    const text = readFileSync(path, "utf8");
    for (const [, context, messages] of text.matchAll(/<context>\s*<name>(.*?)<\/name>(.*?)<\/context>/gs)) {
        for (const [message] of messages.matchAll(/<message>.*?<\/message>/gs)) {
            const source = message.match(/<source>(.*?)<\/source>/s)?.[1] ?? "";
            if (withVanished || !/<translation[^>]*type="(?:vanished|obsolete)"/.test(message))
                keys.add(`${unescapeXml(context)}|${unescapeXml(source)}`);
        }
    }
    return keys;
};

const usedStrings = () => {
    const keys = new Set();
    for (const folder of ["private", "public"]) {
        for (const file of readdirSync(join(repoDir, folder), { recursive: true })) {
            if (!/\.(?:html|js)$/.test(file))
                continue;
            const text = readFileSync(join(repoDir, folder, file), "utf8");
            for (const [, source, context] of text.matchAll(/QBT_TR\((.*?)\)QBT_TR\[CONTEXT=([^\]]+)\]/gs))
                keys.add(`${context}|${source}`);
        }
    }
    return keys;
};

test("Mobile-qbit's strings are in translations/mobile", () => {
    const upstream = readTs(join(repoDir, "translations", "webui_en.ts"), false);
    const mobileStrings = [...usedStrings()].filter((key) => !upstream.has(key));
    expect(mobileStrings.length).toBeGreaterThan(0);

    const languages = readdirSync(join(repoDir, "translations")).filter((file) => /^webui_.*\.ts$/.test(file));
    for (const file of languages) {
        const mobile = readTs(join(repoDir, "translations", "mobile", file));
        const missing = mobileStrings.filter((key) => !mobile.has(key));
        expect(missing, `run python3 tools/update-translations.py (missing in translations/mobile/${file})`).toEqual([]);
    }
});
