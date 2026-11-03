/** CI-only Chromium checks. Production ships no browser-testing dependency. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const out = "visual-report";
const widths = [1440, 1280, 1279, 1200, 1024, 861, 860, 768, 600, 390, 320];
const routes = ["/", "/feed", "/archive", "/projects", "/about", "/post/a-room-on-the-internet"];
const variants = [
  { skin: "editorial", theme: "light" },
  { skin: "editorial", theme: "dark" },
  { skin: "terminal", theme: "light" },
  { skin: "terminal", theme: "dark" },
];
await mkdir(out, { recursive: true });
const preview = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [preview.stdout, preview.stderr])
  stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-3000); });
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (preview.exitCode !== null) throw new Error("Preview stopped: " + serverLog);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview not ready: " + serverLog);
}
function sameBox(actual, expected, label) {
  assert.ok(actual && expected, `${label}: missing control`);
  for (const key of ["left", "top", "width", "height"])
    assert.ok(Math.abs(actual[key] - expected[key]) <= 1,
      `${label}: ${key} moved from ${expected[key]} to ${actual[key]}`);
}
const results = [], notificationResults = [], baselines = new Map();
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const variant of variants) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 }, deviceScaleFactor: 1,
        reducedMotion: "reduce", hasTouch: width <= 1024, isMobile: width <= 1024,
      });
      await context.addInitScript(({ skin, theme }) => {
        localStorage.setItem("echo:skin", JSON.stringify(skin));
        localStorage.setItem("echo:theme", JSON.stringify(theme));
        localStorage.setItem("echo:motion", JSON.stringify("reduced"));
      }, variant);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        for (const route of routes) {
          const target = origin + (route === "/" ? "/" : route + "/");
          const response = await page.goto(target, { waitUntil: "domcontentloaded" });
          const label = `${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}-${width}-${variant.skin}-${variant.theme}`;
          assert.ok(response?.ok(), `${label}: HTTP response failed`);
          // This state change is made by the first React effect, after hydration.
          await page.getByRole("button", { name: "搜索（Ctrl K）", exact: true }).waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForFunction(() => !document.documentElement.classList.contains("font-wait") && !document.documentElement.classList.contains("font-loader-out"));
          const geometry = await page.evaluate(() => {
            const rect = (element) => {
              if (!element || getComputedStyle(element).display === "none") return null;
              const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
              return { left, top, right, bottom, width, height };
            };
            const select = (selector) => rect(document.querySelector(selector));
            return {
              viewport: document.documentElement.clientWidth,
              documentWidth: document.documentElement.scrollWidth,
              skin: document.documentElement.dataset.skin,
              theme: document.documentElement.dataset.theme,
              brand: select(".brand"), nav: select("#site-nav"), tools: select(".header-tools"),
              navigation: [...document.querySelectorAll(".nav-label")].map((el) => el.textContent),
              controls: [".header-search", ".shelf-trigger", '.header-tools > button[aria-label="阅读设置"]'].map(select),
              column: select(".content-grid .feed-column"), sidebar: select(".content-grid .site-sidebar"),
              heroAction: select(".home-hero .primary-button"),
              types: [...document.querySelectorAll(".type-tab")].map(rect),
              meta: select(".entry-meta"), bookmark: select(".entry-meta .card-bookmark"),
              bookmarkOpacity: document.querySelector(".card-bookmark") && getComputedStyle(document.querySelector(".card-bookmark")).opacity,
              years: document.querySelectorAll(".archive-year").length,
              yearLinks: document.querySelectorAll(".archive-year-nav a").length,
              archiveOverview: !!document.querySelector(".timeline-overview"),
              archiveTitle: document.querySelector(".archive-heading h1")?.textContent,
              hero: select(".home-hero"),
              firstHeading: select(".home-feed .feed-body h2"),
              homeHeadingBars: document.querySelectorAll(".home-feed-heading").length,
              archiveRows: document.querySelectorAll(".archive-row").length,
              archiveFilters: document.querySelectorAll(".archive-main .type-tabs").length,
              readerFont: document.querySelector(".reader-prose") && getComputedStyle(document.querySelector(".reader-prose")).fontSize,
            };
          });
          results.push({ route, width, ...variant, ...geometry });
          // Capture before assertions so a failing state is available to review.
          if ([1440, 768, 390, 320].includes(width))
            await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          assert.equal(geometry.skin, variant.skin, `${label}: incorrect skin`);
          assert.equal(geometry.theme, variant.theme, `${label}: incorrect color mode`);
          assert.ok(geometry.documentWidth <= geometry.viewport + 1, `${label}: horizontal overflow`);
          assert.deepEqual(geometry.navigation, ["首页", "内容", "归档", "关于"], `${label}: destination names changed`);
          assert.ok(geometry.brand.right <= (geometry.nav || geometry.tools).left + 1, `${label}: brand overlaps header`);
          if (geometry.nav) assert.ok(geometry.nav.right <= geometry.tools.left + 1, `${label}: navigation overlaps actions`);
          for (const control of geometry.controls) {
            assert.ok(control && control.width >= 44 && control.height >= 44, `${label}: small header target`);
            assert.ok(control.left >= 0 && control.right <= geometry.viewport, `${label}: clipped header action`);
          }
          if (geometry.column && geometry.sidebar) {
            assert.ok(width >= 1280
              ? geometry.column.right <= geometry.sidebar.left + 1
              : geometry.column.bottom <= geometry.sidebar.top + 1, `${label}: sidebar overlaps content`);
          }
          if (geometry.bookmark) {
            assert.ok(geometry.bookmark.width >= 40 && geometry.bookmark.height >= 40, `${label}: small save target`);
            assert.equal(geometry.bookmarkOpacity, "1", `${label}: save target hidden`);
            assert.ok(geometry.bookmark.left >= geometry.meta.left && geometry.bookmark.right <= geometry.meta.right + 1,
              `${label}: save target escaped its metadata row`);
          }
          if (route === "/feed") {
            assert.equal(geometry.types.length, 6, `${label}: missing type filters`);
            assert.ok(geometry.types.every((tab) => tab && tab.left >= 0 && tab.right <= geometry.viewport && tab.height >= 40), `${label}: clipped/small filter`);
          }
          if (route === "/archive") {
            assert.equal(geometry.archiveFilters, 0, `${label}: duplicated archive filters`);
            assert.ok(geometry.years > 0 && geometry.archiveRows > 0, `${label}: missing archive entries`);
            assert.equal(geometry.archiveTitle, "归档", `${label}: archive label inconsistent`);
            assert.equal(geometry.archiveOverview, false, `${label}: obsolete archive card returned`);
            if (geometry.years === 1) assert.equal(geometry.yearLinks, 0, `${label}: isolated year button returned`);
          }
          if (route === "/") {
            assert.equal(geometry.homeHeadingBars, 0, `${label}: detached update bar returned`);
            assert.ok(geometry.hero && geometry.hero.height <= 300, `${label}: introduction dominates the first screen`);
            if (geometry.firstHeading) assert.ok(geometry.firstHeading.top < 740, `${label}: first article pushed below the first screen`);
          }
          const key = `${width}:${route}`, baseline = baselines.get(key);
          if (!baseline) baselines.set(key, geometry);
          else {
            geometry.controls.forEach((box, i) => sameBox(box, baseline.controls[i], `${label}: header action ${i}`));
            if (geometry.nav) sameBox(geometry.nav, baseline.nav, `${label}: navigation`);
            if (geometry.heroAction) sameBox(geometry.heroAction, baseline.heroAction, `${label}: homepage action`);
            if (geometry.readerFont) assert.equal(geometry.readerFont, baseline.readerFont, `${label}: reader font size changed with skin`);
          }

          if (route === "/" && [320, 768, 860].includes(width)) {
            await page.getByRole("button", { name: "打开导航", exact: true }).click();
            await page.getByRole("button", { name: "关闭导航", exact: true }).waitFor();
            assert.equal(await page.locator("#site-nav a").count(), 4);
            assert.equal(await page.locator("#site-nav a").first().evaluate((el) => el === document.activeElement), true, `${label}: menu focus missing`);
            const bounds = await page.locator("#site-nav").boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900, `${label}: menu outside viewport`);
            await page.screenshot({ path: `${out}/${label}-menu.png`, animations: "disabled" });
            await page.keyboard.press("Escape");
            await page.getByRole("button", { name: "打开导航", exact: true }).waitFor();
            assert.equal(await page.locator(".mobile-menu").evaluate((el) => el === document.activeElement), true, `${label}: Escape lost focus`);
          }
          if (route === "/" && [320, 768, 1440].includes(width)) {
            await page.getByRole("button", { name: "阅读设置", exact: true }).click();
            const settings = page.getByRole("dialog", { name: "阅读设置", exact: true });
            await settings.waitFor();
            const close = settings.getByRole("button", { name: "关闭", exact: true });
            const closeBox = await close.boundingBox();
            assert.ok(closeBox && closeBox.width >= 44 && closeBox.height >= 44 && closeBox.x >= 0 && closeBox.x + closeBox.width <= width, `${label}: dialog close target clipped`);
            const other = variant.skin === "editorial" ? "terminal" : "editorial";
            await settings.locator(`.skin-choice-${other}`).click();
            assert.equal(await page.locator("html").getAttribute("data-skin"), other, `${label}: theme switch failed`);
            sameBox(await close.boundingBox().then((b) => b && ({ left: b.x, top: b.y, width: b.width, height: b.height })),
              { left: closeBox.x, top: closeBox.y, width: closeBox.width, height: closeBox.height }, `${label}: close moved after theme switch`);
            await settings.locator(`.skin-choice-${variant.skin}`).click();
            await page.screenshot({ path: `${out}/${label}-settings.png`, animations: "disabled" });
            await close.click();
            await settings.waitFor({ state: "hidden" });
          }
          assert.deepEqual(errors, [], `${label}: browser runtime error`);
        }
        // Availability changes after the session request. Exercise the optional
        // inbox independently, without inventing a signed-in user or messages.
        if ([320, 768].includes(width)) {
          await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
          await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: true } }));
          await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
          const bell = page.getByRole("button", { name: "消息通知，0 条未读", exact: true });
          await bell.waitFor();
          await page.waitForFunction(() => !document.documentElement.classList.contains("font-wait") && !document.documentElement.classList.contains("font-loader-out"));
          await bell.click();
          const inbox = page.getByRole("region", { name: "消息通知", exact: true });
          const bounds = await inbox.boundingBox();
          const label = `inbox-${width}-${variant.skin}-${variant.theme}`;
          await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          notificationResults.push({ width, ...variant, bounds });
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900,
            `${label}: inbox escaped viewport`);
          for (const [index, selector] of [[1, ".shelf-trigger"], [2, '.header-tools > button[aria-label="阅读设置"]']]) {
            const box = await page.locator(selector).boundingBox();
            sameBox(box && { left: box.x, top: box.y, width: box.width, height: box.height },
              baselines.get(`${width}:/`).controls[index], `${label}: existing action moved when inbox appeared`);
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
            `${label}: optional inbox introduced horizontal scrolling`);
          assert.deepEqual(errors, [], `${label}: browser runtime error`);
        }
      } finally { await context.close(); }
    }
  }
  console.log(`Visual geometry checks passed: ${results.length} page/viewport/appearance combinations plus ${notificationResults.length} optional inbox cases, including menu focus and theme position parity.`);
} catch (error) {
  await writeFile(`${out}/failure.txt`, error.stack || String(error));
  throw error;
} finally {
  await writeFile(`${out}/geometry.json`, JSON.stringify(results, null, 2));
  await writeFile(`${out}/notifications.json`, JSON.stringify(notificationResults, null, 2));
  await browser?.close();
  preview.kill("SIGTERM");
  preview.stdout.destroy(); preview.stderr.destroy();
}
