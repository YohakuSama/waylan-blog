/** CI-only Chromium checks. Production ships no browser-testing dependency. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const out = "visual-report";
const widths = [1440, 1280, 1279, 1200, 1024, 861, 860, 768, 600, 390, 320];
const headerControls = [".header-search", ".shelf-trigger", ".notification-trigger", '.header-tools > button[aria-label="阅读设置"]'];
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
        if (localStorage.getItem("echo:density") === null)
          localStorage.setItem("echo:density", JSON.stringify("compact"));
        localStorage.setItem("echo:reading", JSON.stringify({ slug: "a-room-on-the-internet", title: "静态优先：内容站的预渲染、水合与边缘 API", progress: 13 }));
      }, variant);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
      await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: false } }));
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
          // The initial saved preference exercises homepage isolation. Inspect
          // the full library layout at every width before testing compact mode.
          if (route === "/feed") {
            await page.getByRole("button", { name: "详细列表", exact: true }).click();
            await page.locator(".feed-list.density-full").waitFor();
          }
          const geometry = await page.evaluate((headerControls) => {
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
              controls: headerControls.map(select),
              column: select(".content-grid .feed-column"), sidebar: select(".content-grid .site-sidebar"),
              heroAction: select(".hero-browse"),
              types: [...document.querySelectorAll(".type-tab")].filter((el) => el.getClientRects().length).map(rect),
              mobileType: select(".mobile-type-select"),
              mobileTypeOptions: document.querySelector(".mobile-type-select select")?.options.length,
              feedControls: select(".feed-controls"),
              meta: select(".entry-meta"), bookmark: select(".entry-meta .card-bookmark"),
              bookmarkOpacity: document.querySelector(".card-bookmark") && getComputedStyle(document.querySelector(".card-bookmark")).opacity,
              years: document.querySelectorAll(".archive-year").length,
              yearLinks: document.querySelectorAll(".archive-year-nav a").length,
              archiveOverview: !!document.querySelector(".timeline-overview"),
              archiveTitle: document.querySelector(".archive-heading h1")?.textContent,
              hero: select(".home-hero"),
              firstHeading: select(".home-feed .feed-body h2"),
              firstMedia: select(".feed-list .feed-media-link"),
              entryHeading: select(".feed-list .feed-body h2"),
              latestHeading: select("#latest-heading"),
              identity: select(".home-identity"),
              homeLinks: [...document.querySelectorAll(".home-links a")].map((el) => el.getAttribute("href")),
              homeDensity: document.querySelector(".home-list")?.className,
              homeEntryCount: document.querySelectorAll(".home-list .feed-item").length,
              homeSecondEntry: rect(document.querySelectorAll(".home-list .feed-item")[1]),
              resume: select(".home-resume"),
              densityControls: [...document.querySelectorAll(".view-toggle button")].map(rect),
              homeHeadingBars: document.querySelectorAll(".home-feed-heading").length,
              archiveRows: document.querySelectorAll(".archive-row").length,
              archiveFilters: document.querySelectorAll(".archive-main .type-tabs").length,
              readerFont: document.querySelector(".reader-prose") && getComputedStyle(document.querySelector(".reader-prose")).fontSize,
            };
          }, headerControls);
          results.push({ route, width, ...variant, ...geometry });
          // Capture before assertions so a failing state is available to review.
          if ([1440, 768, 390, 320].includes(width))
            await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          assert.equal(geometry.skin, variant.skin, `${label}: incorrect skin`);
          assert.equal(geometry.theme, variant.theme, `${label}: incorrect color mode`);
          assert.ok(geometry.documentWidth <= geometry.viewport + 1, `${label}: horizontal overflow`);
          assert.deepEqual(geometry.navigation, ["首页", "内容", "归档", "项目", "关于"], `${label}: destination names changed`);
          assert.ok(geometry.brand.right <= (width > 860 ? geometry.nav : geometry.tools).left + 1, `${label}: brand overlaps header`);
          assert.ok(geometry.nav, `${label}: primary destinations are hidden`);
          if (width > 860) assert.ok(geometry.nav.right <= geometry.tools.left + 1, `${label}: navigation overlaps actions`);
          else assert.ok(geometry.nav.top >= geometry.tools.bottom && geometry.nav.height >= 43, `${label}: destinations not separated from utilities`);
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
            if (width <= 700) {
              assert.equal(geometry.types.length, 0, `${label}: desktop type pills duplicate the phone picker`);
              assert.equal(geometry.mobileTypeOptions, 6, `${label}: phone picker lost content types`);
              assert.ok(geometry.feedControls && geometry.feedControls.height < 150,
                `${label}: phone filters consume too much of the first screen`);
              assert.ok(geometry.mobileType && geometry.mobileType.height >= 44 &&
                geometry.mobileType.left >= 0 && geometry.mobileType.right <= geometry.viewport,
                `${label}: missing/clipped phone type picker`);
            } else {
              assert.equal(geometry.types.length, 6, `${label}: missing tablet/desktop type filters`);
              assert.equal(geometry.mobileType, null, `${label}: duplicated type filter on wider screen`);
              assert.ok(geometry.types.every((tab) => tab && tab.left >= 0 &&
                tab.right <= geometry.viewport && tab.height >= 40), `${label}: clipped/small filter`);
            }
            assert.ok(geometry.densityControls.length === 2 && geometry.densityControls.every((box) => box && box.width >= 40 && box.height >= 40), `${label}: density preference cannot be changed`);
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
            assert.ok(geometry.hero && geometry.hero.height <= 380, `${label}: introduction dominates the first screen`);
            assert.ok(geometry.identity && geometry.identity.height > 10, `${label}: blog identity missing`);
            assert.ok(geometry.latestHeading && geometry.latestHeading.height > 20, `${label}: latest section heading hidden`);
            assert.ok(geometry.homeLinks.includes("/about") && geometry.homeLinks.includes("/rss.xml"), `${label}: essential blog entry points buried in sidebar`);
            assert.ok(geometry.homeDensity?.includes("density-full"), `${label}: library density leaked into home`);
            assert.equal(geometry.homeEntryCount, 6, `${label}: homepage became a full library`);
            assert.ok(geometry.resume && geometry.resume.width <= geometry.viewport, `${label}: resume entry missing or clipped`);
            if (width <= 768) assert.ok(geometry.homeSecondEntry?.top < 820, `${label}: second entry is buried below the first screen`);
            if (geometry.firstHeading) assert.ok(geometry.firstHeading.top < 660, `${label}: first article pushed below the first screen`);
          }
          if (width < 768 && geometry.entryHeading && geometry.firstMedia) {
            assert.ok(geometry.entryHeading.bottom < geometry.firstMedia.top, `${label}: cover precedes article identity on phone`);
          }
          const key = `${width}:${route}`, baseline = baselines.get(key);
          if (!baseline) baselines.set(key, geometry);
          else {
            geometry.controls.forEach((box, i) => sameBox(box, baseline.controls[i], `${label}: header action ${i}`));
            if (geometry.nav) sameBox(geometry.nav, baseline.nav, `${label}: navigation`);
            if (geometry.heroAction) sameBox(geometry.heroAction, baseline.heroAction, `${label}: homepage action`);
            if (geometry.readerFont) assert.equal(geometry.readerFont, baseline.readerFont, `${label}: reader font size changed with skin`);
          }

          if (route === "/feed" && [320, 768, 1440].includes(width)) {
            const newest = await page.locator(".feed-item time").first().getAttribute("datetime");
            await page.getByRole("button", { name: "详细列表", exact: true }).click();
            await page.locator(".feed-list.density-full").waitFor();
            assert.equal(await page.locator(".feed-media-link").first().isVisible(), true, `${label}: cannot restore detailed view`);
            await page.locator(".sort-control select").selectOption("oldest");
            await page.waitForURL("**sort=oldest");
            assert.notEqual(await page.locator(".feed-item time").first().getAttribute("datetime"), newest, `${label}: sort not applied`);
            await page.getByRole("button", { name: "紧凑列表", exact: true }).click();
            // Vite preview resolves prerendered directory indexes with a
            // trailing slash; use that existing page for the full reload.
            // The production Worker canonicalizes these same routes itself.
            const reloadURL = new URL(page.url());
            reloadURL.pathname = "/feed/";
            await page.goto(reloadURL.href, { waitUntil: "domcontentloaded" });
            await page.locator(".feed-list.density-compact").waitFor();
            await page.locator('#site-nav a[href="/"]').click();
            await page.locator(".home-list.density-full").waitFor();
            assert.equal(await page.locator(".home-list time").first().getAttribute("datetime"), newest, `${label}: library sorting leaked into home`);
            await page.locator('#site-nav a[href="/feed"]').click();
            await page.locator(".feed-list.density-compact").waitFor();
            await page.getByRole("button", { name: "详细列表", exact: true }).click();
            await page.locator(".feed-list.density-full").waitFor();
            if ([320, 768, 1440].includes(width)) await page.screenshot({ path: `${out}/${label}-detailed.png`, animations: "disabled" });
          }
          if (route.startsWith("/post/") && [320, 768, 1024].includes(width)) {
            await page.setViewportSize({ width, height: 480 });
            await page.getByRole("button", { name: "展开文章目录", exact: true }).click();
            const toc = page.locator(".reader-toc.toc-visible");
            await toc.waitFor();
            const bounds = await toc.boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 60 && bounds.y + bounds.height <= 480, `${label}: directory escapes a short viewport`);
            assert.equal(await toc.locator("nav a").first().evaluate((el) => el === document.activeElement), true, `${label}: directory focus missing`);
            await page.screenshot({ path: `${out}/${label}-directory.png`, animations: "disabled" });
            await page.keyboard.press("Escape");
            await toc.waitFor({ state: "hidden" });
            assert.equal(await page.locator(".mobile-toc").evaluate((el) => el === document.activeElement), true, `${label}: directory Escape lost focus`);
            await page.setViewportSize({ width, height: 900 });
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
        // All four header actions stay in place when the service is enabled,
        // disabled or unavailable. No signed-in user or messages are invented.
        if ([320, 768].includes(width)) {
          await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: true } }));
          await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
          const bell = page.getByRole("button", { name: "消息通知，0 条未读", exact: true });
          await bell.waitFor();
          await page.waitForFunction(() => !document.documentElement.classList.contains("font-wait") && !document.documentElement.classList.contains("font-loader-out"));
          await bell.click();
          const inbox = page.getByRole("dialog", { name: "消息通知", exact: true });
          assert.equal(await bell.getAttribute("aria-haspopup"), "dialog");
          assert.equal(await bell.getAttribute("aria-controls"), "notification-panel");
          await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "关闭消息");
          const bounds = await inbox.boundingBox();
          const label = `inbox-${width}-${variant.skin}-${variant.theme}`;
          await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          notificationResults.push({ width, ...variant, state: "enabled", bounds });
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900,
            `${label}: inbox escaped viewport`);
          for (const [index, selector] of headerControls.entries()) {
            const box = await page.locator(selector).boundingBox();
            sameBox(box && { left: box.x, top: box.y, width: box.width, height: box.height },
              baselines.get(`${width}:/`).controls[index], `${label}: header action ${index} moved with service state`);
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
            `${label}: inbox introduced horizontal scrolling`);
          await inbox.getByRole("button", { name: "关闭消息", exact: true }).click();
          await page.waitForFunction(() => document.activeElement?.classList.contains("notification-trigger"));
          await bell.press("Enter");
          await inbox.waitFor({ state: "visible" });
          await page.keyboard.press("Escape");
          await inbox.waitFor({ state: "hidden" });
          await page.waitForFunction(() => document.activeElement?.classList.contains("notification-trigger"));
          await page.route("**/api/status", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
          await page.reload({ waitUntil: "domcontentloaded" });
          const retryBell = page.getByRole("button", { name: "消息通知", exact: true });
          await retryBell.click();
          await page.getByText("暂时无法读取通知，请重试。", { exact: true }).waitFor();
          const errorBounds = await inbox.boundingBox();
          notificationResults.push({ width, ...variant, state: "error", bounds: errorBounds });
          assert.ok(errorBounds && errorBounds.x >= 0 && errorBounds.x + errorBounds.width <= width && errorBounds.y + errorBounds.height <= 900,
            `${label}: error panel escaped viewport`);
          await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: true } }));
          await inbox.getByRole("button", { name: "重试", exact: true }).click();
          await inbox.getByRole("button", { name: "使用 GitHub 登录", exact: true }).waitFor();
          assert.deepEqual(errors, [], `${label}: browser runtime error`);
        }
      } finally { await context.close(); }
    }
  }
  console.log(`Visual geometry checks passed: ${results.length} page/viewport/appearance combinations plus ${notificationResults.length} enabled/error inbox states and retry, including persistent navigation, page-state isolation and theme position parity.`);
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
