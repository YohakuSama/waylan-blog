/** Manual, read-only mobile density checks against the built local preview.
 * Uses a locally installed Edge or Chrome; no browser download or production writes.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4187";
const output = "mobile-layout-report";
const viewports = [320, 390, 768, 1440];
const observations = [];
await mkdir(output, { recursive: true });

const preview = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4187", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let previewLog = "";
let previewError;
preview.on("error", (error) => { previewError = error; });
for (const stream of [preview.stdout, preview.stderr]) {
  stream.on("data", (chunk) => { previewLog = (previewLog + chunk).slice(-3000); });
}
async function waitForPreview() {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (previewError) throw previewError;
    if (preview.exitCode !== null) throw new Error("Preview exited: " + previewLog);
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* Waiting for localhost preview. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Preview did not start: " + previewLog);
}
function ensureBounds(box, label) {
  assert.ok(box && box.width > 0 && box.height > 0, label + " is not visible");
}
async function capture(page, route, width) {
  return page.evaluate(({ route, width }) => {
    function rect(selector) {
      const node = document.querySelector(selector);
      if (!node || getComputedStyle(node).display === "none") return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, top: r.top, bottom: r.bottom,
        left: r.left, right: r.right, width: r.width, height: r.height };
    }
    if (route === "feed") {
      const card = ".feed-list.density-full > .feed-item.is-article.has-media";
      return {
        route, width,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        card: rect(card),
        bodyDisplay: getComputedStyle(document.querySelector(card + " > .feed-body")).display,
        meta: rect(card + " .entry-meta"),
        title: rect(card + " h2"),
        excerpt: rect(card + " .feed-excerpt"),
        media: rect(card + " .feed-media-link"),
        tags: rect(card + " .tag-list"),
      };
    }
    return {
      route, width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      heading: rect(".reading-article .article-heading"),
      title: rect(".reading-article .article-heading h1"),
      deck: rect(".reading-article .article-deck"),
      byline: rect(".reading-article .article-byline"),
      author: rect(".reading-article .article-author"),
      meta: rect(".reading-article .article-meta"),
      actions: rect(".reading-article .article-actions"),
      cover: rect(".reading-article .article-cover"),
      deckClamp: document.querySelector(".reading-article .article-deck")
        ? getComputedStyle(document.querySelector(".reading-article .article-deck")).webkitLineClamp
        : null,
    };
  }, { route, width });
}
let browser;
try {
  await waitForPreview();
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
  } catch (edgeError) {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      throw new Error("Install Microsoft Edge or Google Chrome to run the local layout audit: " + edgeError.message);
    }
  }

  for (const width of viewports) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      isMobile: width <= 600,
      hasTouch: width <= 600,
    });
    await context.addInitScript(() => {
      localStorage.setItem("echo:skin", JSON.stringify("editorial"));
      localStorage.setItem("echo:theme", JSON.stringify("light"));
      localStorage.setItem("echo:motion", JSON.stringify("reduced"));
      localStorage.setItem("echo:density", JSON.stringify("full"));
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => { pageErrors.push(error.message); });
    await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
    await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: false } }));
    try {
      for (const [route, path] of [
        ["feed", "/feed/"],
        ["article", "/post/a-room-on-the-internet/"],
      ]) {
        const response = await page.goto(origin + path, { waitUntil: "domcontentloaded" });
        assert.ok(response?.ok(), route + " failed to load");
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
          !document.documentElement.classList.contains("font-wait") &&
          !document.documentElement.classList.contains("font-loader-out"));
        if (route === "feed") {
          await page.locator(".feed-list.density-full > .feed-item.is-article.has-media").first().waitFor();
        } else {
          await page.locator(".reading-article .article-heading").waitFor();
        }
        const geometry = await capture(page, route, width);
        observations.push(geometry);
        assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1,
          route + " " + width + ": horizontal document overflow");
        if (route === "feed") {
          ensureBounds(geometry.card, "Feed article card");
          ensureBounds(geometry.media, "Feed cover");
          ensureBounds(geometry.excerpt, "Feed excerpt");
          if (width <= 600) {
            assert.equal(geometry.bodyDisplay, "contents", "Phone article needs compact grid tracks");
            assert.ok(geometry.media.width <= 128, "Phone article image is not a thumbnail");
            assert.ok(Math.abs(geometry.media.top - geometry.excerpt.top) <= 3,
              "Phone article image must sit alongside excerpt");
            assert.ok(geometry.card.height < (width <= 320 ? 385 : 325),
              "Phone article card still consumes excessive vertical space: " + geometry.card.height);
          }
        } else {
          ensureBounds(geometry.heading, "Article heading");
          ensureBounds(geometry.cover, "Article cover");
          if (width <= 600) {
            assert.equal(geometry.deckClamp, "2", "Phone article intro must stay within two lines");
            assert.ok(geometry.heading.height < (width <= 320 ? 365 : 300),
              "Phone reading header still occupies too much height: " + geometry.heading.height);
            assert.ok(geometry.cover.top - geometry.actions.bottom <= 20,
              "Large blank gap remains between article controls and cover");
          }
        }
        await page.screenshot({
          path: `${output}/${route}-${width}.png`,
          animations: "disabled",
        });
        assert.deepEqual(pageErrors, [], route + " " + width + ": browser runtime errors");
        console.log(`${route} ${width}px: geometry verified`);
      }
    } finally {
      await context.close();
    }
  }
  console.log("Mobile density audit passed for phone, tablet and desktop.");
} catch (error) {
  await writeFile(`${output}/failure.txt`, error.stack || String(error));
  throw error;
} finally {
  await writeFile(`${output}/geometry.json`, JSON.stringify(observations, null, 2));
  await browser?.close();
  preview.kill();
  preview.stdout.destroy();
  preview.stderr.destroy();
}
