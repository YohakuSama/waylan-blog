/**
 * Fast, behavior-oriented browser verification for ordinary UI changes.
 * Checks affected pages at representative phone/tablet/desktop widths.
 * The exhaustive visual-smoke.mjs matrix remains available for major
 * cross-cutting changes and explicit workflow_dispatch audits.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const scope = process.env.WAYLAN_VISUAL_SCOPE || "all";
const pageGroups = {
  all: ["/", "/feed", "/archive", "/projects", "/about", "/privacy",
    "/post/a-room-on-the-internet", "/404"],
  feed: ["/", "/feed", "/archive"],
  // A responsive hunk under the feed toolbar affects only this page.
  "feed-only": ["/feed"],
  "feed-phone": ["/feed"],
  home: ["/"],
  archive: ["/", "/feed", "/archive"],
  projects: ["/", "/projects"],
  about: ["/", "/about"],
  reader: ["/", "/post/a-room-on-the-internet"],
};
assert.ok(Object.hasOwn(pageGroups, scope), "Unknown visual scope: " + scope);
const widths = scope === "feed-phone"
  ? [768, 767, 390, 320] // both sides of the phone breakpoint
  : [1440, 1024, 768, 767, 390, 320];
const appearances = [
  { skin: "editorial", theme: "light" },
  { skin: "terminal", theme: "dark" },
];
const out = "visual-report";
await mkdir(out, { recursive: true });

const preview = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1",
    "--port", "4173", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [preview.stdout, preview.stderr])
  stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-2000); });

async function ready() {
  for (let i = 0; i < 100; i++) {
    if (preview.exitCode !== null) throw new Error("Preview stopped: " + serverLog);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview not ready: " + serverLog);
}

let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  let verified = 0;
  for (const appearance of appearances) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce", hasTouch: width <= 1024, isMobile: width <= 1024,
      });
      await context.addInitScript(({ skin, theme }) => {
        localStorage.setItem("echo:skin", JSON.stringify(skin));
        localStorage.setItem("echo:theme", JSON.stringify(theme));
        localStorage.setItem("echo:motion", JSON.stringify("reduced"));
      }, appearance);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/session", (route) =>
        route.fulfill({ json: { user: null } }));
      await page.route("**/api/status", (route) =>
        route.fulfill({ json: { notifications: false } }));
      try {
        for (const route of pageGroups[scope]) {
          const label = [scope, width, appearance.skin, appearance.theme,
            route.replaceAll("/", "-") || "home"].join("-");
          try {
            const target = origin +
              (route === "/" ? "/" : route === "/404" ? "/404.html" : route + "/");
            const response = await page.goto(target, { waitUntil: "domcontentloaded" });
            assert.ok(response?.ok(), label + ": route failed to load");
            await page.locator("main").first().waitFor({ state: "visible" });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForFunction(() =>
              !document.documentElement.classList.contains("font-wait") &&
              !document.documentElement.classList.contains("font-loader-out"));
            const layout = await page.evaluate(() => {
              const root = document.documentElement;
              const main = document.querySelector("main");
              const box = main?.getBoundingClientRect();
              return {
                viewport: root.clientWidth, document: root.scrollWidth,
                mainWidth: box?.width ?? 0, mainLeft: box?.left ?? -1,
                mainRight: box?.right ?? Infinity,
                headings: main?.querySelectorAll("h1").length ?? 0,
              };
            });
            assert.ok(layout.mainWidth > 0 && layout.mainLeft >= -1 &&
              layout.mainRight <= layout.viewport + 1,
              label + ": main content is clipped: " + JSON.stringify(layout));
            assert.ok(layout.document <= layout.viewport + 1,
              label + ": horizontal overflow: " + JSON.stringify(layout));
            assert.ok(layout.headings > 0, label + ": page heading missing");
            assert.deepEqual(errors, [], label + ": browser runtime errors");
            errors.length = 0;
            if (route === "/feed" && width <= 767) {
              const buttons = page.locator(".view-toggle button:visible");
              assert.ok(await buttons.count() >= 2, label + ": feed view switch missing");
              const targets = await buttons.evaluateAll((elements) =>
                elements.map((el) => {
                  const r = el.getBoundingClientRect();
                  return { width: r.width, height: r.height, left: r.left,
                    right: r.right };
                }));
              assert.ok(targets.every((r) => r.width >= 40 && r.height >= 40 &&
                r.left >= 0 && r.right <= width + 1),
                label + ": feed touch target clipped or too small: " +
                  JSON.stringify(targets));
            }
            verified++;
          } catch (error) {
            try {
              await page.screenshot({ path: out + "/failed-" + label + ".png",
                fullPage: true, animations: "disabled" });
            } catch {}
            throw error;
          }
        }
      } finally {
        await context.close();
      }
    }
  }
  console.log("Focused visual QA passed: " + verified +
    " route/viewport/appearance cases; scope=" + scope);
} finally {
  await browser?.close();
  preview.kill();
}
