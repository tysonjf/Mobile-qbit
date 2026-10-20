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

import "../../private/scripts/mobile-update.js";

const MobileUpdate = window.qBittorrent.MobileUpdate;

test("Test compareVersions()", () => {
    const compareVersions = MobileUpdate.compareVersions;

    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
    expect(compareVersions("1.1.0-rc1", "1.1.0")).toBe(0);
});

test("Test isCompatible()", () => {
    const isCompatible = MobileUpdate.isCompatible;

    expect(isCompatible("v5.2.4", "5.2")).toBe(true);
    expect(isCompatible("v5.2.0", "5.2")).toBe(true);
    expect(isCompatible("v5.2.10beta1", "5.2")).toBe(true);
    expect(isCompatible("v5.3.0", "5.2")).toBe(false);
    expect(isCompatible("v5.1.4", "5.2")).toBe(false);
    expect(isCompatible("v15.2.0", "5.2")).toBe(false);
});

test("Test getInstallPaths()", () => {
    const getInstallPaths = MobileUpdate.getInstallPaths;

    // first update: the folder Mobile-qbit was installed to is the base
    expect(getInstallPaths("/opt/Mobile-qbit", "v1.0.0", "v1.1.0")).toStrictEqual({
        currentRoot: "/opt/Mobile-qbit",
        isManaged: false,
        versionsPath: "/opt/Mobile-qbit/versions",
        newRoot: "/opt/Mobile-qbit/versions/v1.1.0"
    });
    expect(getInstallPaths("/opt/Mobile-qbit/", "v1.0.0", "v1.1.0").newRoot).toBe("/opt/Mobile-qbit/versions/v1.1.0");

    // later updates: the versions folder stays the same
    expect(getInstallPaths("/opt/Mobile-qbit/versions/v1.1.0", "v1.1.0", "v1.2.0")).toStrictEqual({
        currentRoot: "/opt/Mobile-qbit/versions/v1.1.0",
        isManaged: true,
        versionsPath: "/opt/Mobile-qbit/versions",
        newRoot: "/opt/Mobile-qbit/versions/v1.2.0"
    });

    // a versions folder that doesn't hold the installed version isn't the updater's
    expect(getInstallPaths("/opt/versions/v0.9.0", "v1.1.0", "v1.2.0").isManaged).toBe(false);

    // Windows
    expect(getInstallPaths("C:\\Mobile-qbit", "v1.0.0", "v1.1.0").newRoot).toBe("C:\\Mobile-qbit\\versions\\v1.1.0");
    expect(getInstallPaths("C:\\Mobile-qbit\\versions\\v1.1.0", "v1.1.0", "v1.2.0")).toStrictEqual({
        currentRoot: "C:\\Mobile-qbit\\versions\\v1.1.0",
        isManaged: true,
        versionsPath: "C:\\Mobile-qbit\\versions",
        newRoot: "C:\\Mobile-qbit\\versions\\v1.2.0"
    });
    // qBittorrent on Windows may also report forward slashes
    expect(getInstallPaths("C:/Mobile-qbit/versions/v1.1.0", "v1.1.0", "v1.2.0").versionsPath).toBe("C:/Mobile-qbit/versions");
});

test("Test toPlainText()", () => {
    const toPlainText = MobileUpdate.toPlainText;

    expect(toPlainText("## What's Changed\r\n* Fix the menu by @someone in https://example.org/pull/2\r\n\r\n\r\n**Full Changelog**: https://example.org/compare/v1.0.0...v1.1.0"))
        .toBe("What's Changed\n• Fix the menu by @someone in https://example.org/pull/2\n\nFull Changelog: https://example.org/compare/v1.0.0...v1.1.0");
    expect(toPlainText("- one\n  - two\nSee [the guide](https://example.org/guide).")).toBe("• one\n• two\nSee the guide (https://example.org/guide).");
});
