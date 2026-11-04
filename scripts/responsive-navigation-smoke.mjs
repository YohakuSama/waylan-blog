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
          await page.locator(".brand .brand-tagline").waitFor({ state: "visible" });
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
              brand: get(".brand"), tools: get(".header-tools"), nav: get("#site-nav"),
              header: get(".site-header"), body: get(".site-body"),
              main: get(".site-main"), hero: get(".home-hero"),
              width: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
            };
          });
          const label = scenario.browser + "-" + width;
          observations.push({ label, header });
          assert.ok(header.logo && header.tagline && header.brand && header.tools, label + ": header elements missing");
          assert.ok(header.scrollWidth <= header.width + 1, label + ": horizontal overflow");
          assert.ok(header.tagline.left >= header.logo.right - 3,
            label + ": subtitle detached from logo");
          assert.ok(header.tagline.top < header.logo.bottom && header.tagline.bottom > header.logo.top,
            label + ": subtitle not alongside logo");
          if (width <= 370) {
            assert.ok(header.brand.bottom <= header.tools.top + 2,
              label + ": narrow screen tool row overlaps logo");
          } else if (width <= 860) {
            assert.ok(header.brand.right <= header.tools.left + 2,
              label + ": mobile actions overlap logo or subtitle");
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
          const back = page.locator(".reader-topbar > button").first();
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
