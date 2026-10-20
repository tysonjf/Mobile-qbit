/*
 * Screenshot tour for Mobile-qbit.
 *
 * Opens the WebUI in Chromium for every scenario of a scenario file, runs its
 * steps and takes screenshots. Reports JavaScript errors, failed steps and
 * horizontal overflow of the page.
 *
 * Usage:
 *   node tour.js <scenarios.json> [sizes] [name filter]
 *     sizes: comma separated, default "390x844" (phone). Widths below 800px or
 *            heights below 500px get a touch screen (isMobile, hasTouch).
 *     name filter: regular expression matched against the scenario names
 *
 *   SCHEME=dark  use the dark color scheme
 *   URL=...      WebUI address, default http://127.0.0.1:8080/
 *
 * Screenshots go to dev/.cache/shots/<size>/<scenario>[-<shot>].png
 *
 * Scenario file: an array of { "name": "...", "steps": [ ... ] }. Steps:
 *   { "click": selector }       mouse click
 *   { "tap": selector }         touch tap
 *   { "tapxy": [x, y] }         touch tap at a position
 *   { "longpress": selector }   touch and hold for 800ms
 *   { "js": "code" }            run code in the page
 *   { "eval": "code" }          run code and print its result
 *   { "fill": [selector, text] }
 *   { "files": [selector, file, ...] }  "$TORRENTS" is replaced by dev/.cache/torrents
 *   { "wait": ms }
 *   { "shot": true | "suffix" }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const loadPlaywright = () => {
    try {
        return require("playwright");
    }
    catch {
        // Claude Code cloud environments have a global installation
        return require("/opt/node-tools/node_modules/playwright");
    }
};

(async () => {
    const [scenarioFile, sizesArg = "390x844", filter] = process.argv.slice(2);
    if (!scenarioFile) {
        console.error("Usage: node tour.js <scenarios.json> [sizes] [name filter]");
        process.exit(1);
    }

    const { chromium } = loadPlaywright();
    const torrentsDir = path.join(__dirname, ".cache", "torrents");
    const scenarios = JSON.parse(fs.readFileSync(scenarioFile, "utf8"))
        .filter((scenario) => !filter || new RegExp(filter).test(scenario.name));
    const browser = await chromium.launch();
    let failures = 0;

    for (const size of sizesArg.split(",")) {
        const [width, height] = size.split("x").map(Number);
        const touch = (width < 800) || (height < 500);
        const outDir = path.join(__dirname, ".cache", "shots", size);
        fs.mkdirSync(outDir, { recursive: true });
        const context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: touch ? 2 : 1,
            isMobile: touch,
            hasTouch: touch,
            colorScheme: process.env.SCHEME || "light"
        });

        for (const scenario of scenarios) {
            const page = await context.newPage();
            const problems = [];
            page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
            await page.goto(scenario.url || process.env.URL || "http://127.0.0.1:8080/", { waitUntil: "load" });
            await page.mouse.move(width - 2, height - 2).catch(() => {});
            await page.waitForTimeout(scenario.initialWait ?? 2000);

            for (const step of scenario.steps) {
                try {
                    if (step.click)
                        await page.click(step.click, { timeout: 4000 });
                    if (step.tap)
                        await page.tap(step.tap, { timeout: 4000 });
                    if (step.tapxy)
                        await page.touchscreen.tap(step.tapxy[0], step.tapxy[1]);
                    if (step.js)
                        await page.evaluate(step.js);
                    if (step.fill)
                        await page.fill(step.fill[0], step.fill[1]);
                    if (step.files)
                        await page.setInputFiles(step.files[0], step.files.slice(1).map((file) => file.replace("$TORRENTS", torrentsDir)));
                    if (step.longpress) {
                        const box = await (await page.$(step.longpress)).boundingBox();
                        const x = box.x + Math.min(box.width / 2, 60);
                        const y = box.y + (box.height / 2);
                        const cdp = await context.newCDPSession(page);
                        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
                        await page.waitForTimeout(800);
                        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
                    }
                    if (step.wait)
                        await page.waitForTimeout(step.wait);
                    if (step.eval)
                        console.log(`  ${scenario.name}: ${JSON.stringify(await page.evaluate(step.eval))}`);
                    if (step.shot) {
                        const suffix = (step.shot === true) ? "" : `-${step.shot}`;
                        await page.screenshot({ path: path.join(outDir, `${scenario.name}${suffix}.png`) });
                    }
                }
                catch (error) {
                    problems.push(`step ${JSON.stringify(step).slice(0, 80)}: ${error.message.split("\n")[0]}`);
                }
            }

            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (overflow > 0)
                problems.push(`page is ${overflow}px wider than the screen`);

            failures += problems.length;
            console.log(`[${size}] ${scenario.name}: ${(problems.length > 0) ? problems.join(" | ") : "ok"}`);
            await page.close();
        }
        await context.close();
    }

    await browser.close();
    process.exit((failures > 0) ? 1 : 0);
})();
