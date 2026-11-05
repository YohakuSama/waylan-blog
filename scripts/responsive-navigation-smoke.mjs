/** Cross-device navigation and header regression: Android Chromium, iOS/iPadOS WebKit and desktop. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const origin = "http://127.0.0.1:4182";
const directory = "responsive-navigation-report";
await mkdir(directory, { recursive: true });
const server = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4182", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", chunk => { serverLog = (serverLog + chunk).slice(-3000); });
async function ready() {
  for (let tries = 0; tries < 100; tries++) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error("Preview server failed: " + serverLog);
}
const scenarios = [
  { engine: chromium, browser: "android-chromium", widths: [320, 360, 393, 412, 430, 540], mobile: true },
  { engine: webkit, browser: "ios-webkit", widths: [375, 390, 430], mobile: true },
  { engine: webkit, browser: "ipad-webkit", widths: [768, 820, 1024], mobile: true },
  { engine: chromium, browser: "desktop-chromium", widths: [861, 1100, 1280, 1440, 1920], mobile: false },
];
const observations = [];
const box = element => {
  if (!element || getComputedStyle(element).display === "none") return null;
  const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
  return { top, right, bottom, left, width, height };
};
try {
  await ready();
  for (const scenario of scenarios) {
    const browser = await scenario.engine.launch({ headless: true });
    try {
      for (const width of scenario.widths) {
        const context = await browser.newContext({
          viewport: { width, height: 850 },
          deviceScaleFactor: scenario.mobile ? 2 : 1,
          reducedMotion: "reduce",
          isMobile: scenario.mobile,
          hasTouch: scenario.mobile,
          ...(scenario.browser.startsWith("android") ? {
            userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
          } : {}),
        });
        try {
          await context.addInitScript(() => {
            localStorage.setItem("echo:skin", JSON.stringify("editorial"));
            localStorage.setItem("echo:theme", JSON.stringify("light"));
            localStorage.setItem("echo:motion", JSON.stringify("reduced"));
          });
          const page = await context.newPage(), errors = [];
          page.on("pageerror", error => errors.push(String(error)));
          await page.route("**/api/status", route => route.fulfill({ json: { comments: false, notifications: false } }));
          await page.route("**/api/session", route => route.fulfill({ json: { user: null } }));
          await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
          await page.locator(".brand").waitFor({ state: "visible" });
          await page.evaluate(() => document.fonts.ready);
          const header = await page.evaluate(() => {
            const rect = element => {
              if (!element || getComputedStyle(element).display === "none") return null;
              const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
              return { top, bottom, left, right, width, height };
            };
            const get = selector => rect(document.querySelector(selector));
            return {
              logo: get(".brand-wordmark"), tagline: get(".brand-tagline"),
              searchLabel: get(".header-search-text"),
              controls: [".header-search", ".shelf-trigger", ".notification-trigger", ".header-tools .settings-button"].map(get),
              brand: get(".brand"), tools: get(".header-tools"), nav: get("#site-nav"),
              header: get(".site-header"), body: get(".site-body"),
              main: get(".site-main"), hero: get(".home-hero"),
              width: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
            };
          });
          const label = scenario.browser + "-" + width;
          observations.push({ label, header });
          assert.ok(header.logo && header.brand && header.tools, label + ": header elements missing");
          assert.equal(header.tagline, null, label + ": unused small slogan is still in masthead");
          assert.ok(header.scrollWidth <= header.width + 1, label + ": horizontal overflow");
          if ((width >= 480 && width <= 860) || (width >= 1100 && width <= 1279)) {
            assert.ok(header.searchLabel?.width >= 18,
              label + ": search must make practical use of the available header width");
          }
          if (width <= 860) {
            assert.ok(header.brand.right <= header.tools.left + 2,
              label + ": mobile actions overlap the single logo");
          }
          if (width <= 860) {
            assert.ok(header.nav.top >= header.tools.bottom,
              label + ": mobile navigation row overlaps the touch controls");
          }
          assert.ok(Math.abs(header.header.bottom - header.body.top) <= 1,
            label + ": gap between header and page");
          assert.ok(Math.abs(header.main.top - header.hero.top) <= 1,
            label + ": home hero/banner has an unexpected top gap");
          if ([320, 390, 412, 820, 1440].includes(width))
            await page.screenshot({ path: directory + "/" + label + "-home.png", animations: "disabled" });

          await page.goto(origin + "/feed/", { waitUntil: "domcontentloaded" });
          await page.locator(".feed-list .feed-item").first().waitFor();
          const before = await page.locator(".feed-list .feed-item").count();
          const more = page.locator(".feed-layout button.load-more");
          assert.ok(await more.count(), label + ": fixture must provide another batch");
          await more.click();
          await page.waitForFunction(original => document.querySelectorAll(".feed-list .feed-item").length > original, before);
          const extended = await page.locator(".feed-list .feed-item").count();
          const last = page.locator(".feed-list .feed-item .post-card-link").last();
          await last.scrollIntoViewIfNeeded();
          const originY = await page.evaluate(() => window.scrollY);
          await last.click();
          await page.waitForURL(/\/post\/[^/?]+/);
          await page.locator(".article-actions").waitFor({ state: "visible" });
          const articleMasthead = await page.evaluate(() => {
            const box = (selector) => {
              const el = document.querySelector(selector);
              if (!el || getComputedStyle(el).display === "none") return null;
              const r = el.getBoundingClientRect();
              return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right };
            };
            return {
              logo: box(".site-header-reader .brand-wordmark"),
              brand: box(".site-header-reader .brand"),
              inner: box(".site-header-reader .header-inner"),
              computed: (() => {
                const inner = document.querySelector(".site-header-reader .header-inner");
                const element = inner && getComputedStyle(inner);
                return element ? { gridRows: element.gridTemplateRows, height: element.height,
                  minHeight: element.minHeight, alignItems: element.alignItems,
                  paddingTop: element.paddingTop, paddingBottom: element.paddingBottom } : null;
              })(),
              header: box(".site-header-reader"),
              nav: box(".site-header-reader #site-nav"),
              controls: [".header-search", ".shelf-trigger", ".notification-trigger", ".header-tools .settings-button"].map(box),
              readerHeight: getComputedStyle(document.documentElement).getPropertyValue("--reader-brand-height").trim(),
            };
          });
          assert.ok(articleMasthead.logo && articleMasthead.header, label + ": reader masthead missing");
          const expectedRow = width <= 860 ? 60 : 68;
          if (width <= 1024) {
            assert.ok(Math.abs(articleMasthead.header.height - expectedRow) <= 1,
              label + ": reader's row height differs from home masthead");
            assert.equal(articleMasthead.nav, null,
              label + ": reader must not add home navigation below the shared masthead");
            assert.equal(articleMasthead.readerHeight, expectedRow + "px",
              label + ": scroll and toc offsets must use the row's true height");
          }
          assert.ok(Math.abs(articleMasthead.logo.height - header.logo.height) <= 1 &&
            Math.abs(articleMasthead.logo.top - header.logo.top) <= 1,
            label + ": reader logo size/vertical position differs from home; " + JSON.stringify({home: header.logo, reader: articleMasthead.logo, homeHeader: header.header, readerHeader: articleMasthead.header, inner: articleMasthead.inner, brand: articleMasthead.brand, computed: articleMasthead.computed}));
          for (let i = 0; i < 4; i++) {
            const source = header.controls[i], dest = articleMasthead.controls[i];
            assert.ok(source && dest &&
              Math.abs(source.height - dest.height) <= 1 &&
              Math.abs(dest.width - (i === 0 && width >= 480 && width <= 860 ? 44 : source.width)) <= 1 &&
              Math.abs(source.top - dest.top) <= 1,
              label + ": shortcut " + i + " changes size or height in the article");
            if (width < 480) assert.ok(Math.abs(source.left - dest.left) <= 1,
              label + ": phone shortcut " + i + " moves horizontally between pages");
          }
          const back = page.locator(".reader-back");
          assert.match((await back.innerText()).trim(), /返回列表/, label + ": internal wording exposed");
          await back.click();
          await page.waitForURL(url => url.pathname.replace(/\/$/, "") === "/feed");
          await page.waitForFunction(expected =>
            document.querySelectorAll(".feed-list .feed-item").length === expected, extended);
          await page.waitForFunction(expected => Math.abs(window.scrollY - expected) < 95, originY);
          const restored = await page.evaluate(() => ({
            route: location.pathname,
            scrollY: window.scrollY,
            visible: document.querySelectorAll(".feed-list .feed-item").length,
            more: !!document.querySelector(".feed-layout button.load-more"),
          }));
          assert.equal(restored.visible, extended, label + ": expanded items lost on return");
          assert.ok(!restored.more, label + ": unnecessary second Load More click");
          assert.deepEqual(errors, [], label + ": runtime errors");
          observations.at(-1).navigation = { before, extended, originY, restored };
          if ([390, 412, 820, 1440].includes(width))
            await page.screenshot({ path: directory + "/" + label + "-return.png", animations: "disabled" });
          console.log(label, JSON.stringify({ expanded: extended, restored, headerHeight: header.header.height }));
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await writeFile(directory + "/observations.json", JSON.stringify(observations, null, 2));
  server.kill("SIGTERM");
  server.stdout.destroy();
  server.stderr.destroy();
}
