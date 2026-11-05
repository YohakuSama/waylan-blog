/** Recording-derived regression: route switches must never produce double-rendered pages. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const origin = "http://127.0.0.1:4184", output = "route-motion-ghost-report";
await mkdir(output, { recursive: true });
const server = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4184", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", chunk => { serverLog = (serverLog + chunk).slice(-2400); });
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Preview did not start: " + serverLog);
}
const observations = [];
async function run(engine, label, width, mobile) {
  const browser = await engine.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width, height: 850 },
      reducedMotion: "no-preference", isMobile: mobile, hasTouch: mobile,
    });
    try {
      await ctx.addInitScript(() => {
        localStorage.setItem("echo:motion", JSON.stringify("full"));
        localStorage.setItem("echo:skin", JSON.stringify("editorial"));
        localStorage.setItem("echo:theme", JSON.stringify("dark"));
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.route("**/api/status", route => route.fulfill({ json: { comments: false, notifications: false } }));
      await page.route("**/api/session", route => route.fulfill({ json: { user: null } }));
      await page.route("**/api/views", route => route.fulfill({ json: { enabled: false, views: {} } }));
      await page.route("**/api/posts/*/view", route => route.fulfill({ json: { enabled: false, views: null } }));
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /搜索/ }).first().waitFor();
      await page.evaluate(() => {
        window.__nativeRouteSnapshotCount = 0;
        const original = document.startViewTransition?.bind(document);
        if (original) document.startViewTransition = update => {
          window.__nativeRouteSnapshotCount++;
          return original(update);
        };
      });
      // Clip A: quick About > Projects > Archive > Feed > Home.
      const route = async (href, expected) => {
        await page.locator('#site-nav a[href="' + href + '"]').click();
        await page.waitForURL(url => url.pathname === expected);
        await page.waitForTimeout(65);
        const state = await page.evaluate(() => ({
          route: location.pathname,
          oldNewScreenshots: window.__nativeRouteSnapshotCount,
          ghost: document.querySelectorAll(".shared-cover-ghost").length,
          article: !!document.querySelector(".reader-main .reading-article"),
        }));
        assert.equal(state.oldNewScreenshots, 0, label + ": route created a native screenshot");
        assert.equal(state.ghost, 0, label + ": cover ghost left on screen");
        assert.equal(state.article, false, label + ": old article remained in collection");
        return state;
      };
      const collection = [];
      for (const href of ["/about", "/projects", "/archive", "/feed", "/"])
        collection.push(await route(href, href));
      await page.screenshot({ path: output + "/" + label + "-sections.png", animations: "disabled" });
      // Clip B: lower feed entry > reader > feed > another entry > feed.
      await route("/feed", "/feed");
      const posts = page.locator(".feed-list .post-card-link");
      for (const i of [0, 1]) {
        const card = posts.nth(i);
        await card.scrollIntoViewIfNeeded();
        await card.click();
        await page.waitForURL(/\/post\/[^/?]+/);
        await page.waitForTimeout(65);
        const reader = await page.evaluate(() => ({
          screenshotCount: window.__nativeRouteSnapshotCount,
          oldFeed: !!document.querySelector(".feed-layout .feed-list"),
          reader: !!document.querySelector(".reader-main .reading-article"),
          floatingCovers: document.querySelectorAll(".shared-cover-ghost").length,
          mainAnimations: document.querySelector("main")?.getAnimations().length || 0,
        }));
        assert.equal(reader.screenshotCount, 0, label + ": article open uses native snapshots");
        assert.equal(reader.oldFeed, false, label + ": old feed still painted under reader");
        assert.equal(reader.reader, true, label + ": reader missing");
        assert.equal(reader.floatingCovers, 0, label + ": thumbnail flying over article");
        await page.screenshot({ path: output + "/" + label + "-reader-" + i + ".png" });
        await page.getByRole("button", { name: "返回上一页" }).click();
        await page.waitForURL(url => url.pathname.replace(/\/$/, "") === "/feed");
        await page.waitForTimeout(65);
        const returned = await page.evaluate(() => ({
          screenshotCount: window.__nativeRouteSnapshotCount,
          oldReader: !!document.querySelector(".reader-main .reading-article"),
          feed: !!document.querySelector(".feed-layout .feed-list"),
          flying: document.querySelectorAll(".shared-cover-ghost").length,
        }));
        assert.equal(returned.screenshotCount, 0, label + ": article return uses native snapshots");
        assert.equal(returned.oldReader, false, label + ": old article still painted under feed");
        assert.equal(returned.feed, true, label + ": feed missing after returning");
        assert.equal(returned.flying, 0, label + ": thumbnail flying over feed");
        observations.push({ label, i, reader, returned });
      }
      assert.deepEqual(errors, [], label + ": runtime errors");
      observations.push({ label, collection });
    } finally { await ctx.close(); }
  } finally { await browser.close(); }
}
try {
  await ready();
  await run(webkit, "ios-webkit-390", 390, true);
  await run(chromium, "android-chromium-412", 412, true);
  await run(webkit, "ipad-webkit-820", 820, true);
  await run(chromium, "desktop-chromium-1440", 1440, false);
  console.log("Snapshot-free route audit:", JSON.stringify(observations));
} finally {
  await writeFile(output + "/observations.json", JSON.stringify(observations, null, 2));
  server.kill("SIGTERM");
  server.stdout.destroy();
  server.stderr.destroy();
}
