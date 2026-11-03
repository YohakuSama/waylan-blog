/** Read-only production audit: chronological order and route/animation stability.
 * Never submits forms, changes server data, or creates backend records.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const origin = (process.env.WAYLAN_AUDIT_ORIGIN || "https://waylan.org").replace(/\/$/, "");
const output = "live-motion-report";
await mkdir(output, { recursive: true });
const observations = [];
const failures = [];

function shuffled(items, seed) {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const index = state % (i + 1);
    [out[i], out[index]] = [out[index], out[i]];
  }
  return out;
}

async function checkView(page, label, direction) {
  await page.waitForFunction(
    () => !document.documentElement.hasAttribute("data-list-busy"),
    null, { timeout: 3000 },
  );
  const snapshot = await page.evaluate(() => {
    const list = document.querySelector(".feed-list");
    const cards = [...(list?.querySelectorAll(".feed-item") || [])];
    return {
      dateValues: cards.map((c) => c.querySelector("time")?.getAttribute("datetime") || ""),
      cardIds: cards.map((c) => c.id),
      rects: cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }),
      listWidth: list?.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      busy: document.documentElement.hasAttribute("data-list-busy"),
      hidden: cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight &&
          getComputedStyle(c).opacity === "0";
      }).length,
    };
  });
  assert.ok(snapshot.cardIds.length > 0, label + ": missing cards");
  assert.equal(new Set(snapshot.cardIds).size, snapshot.cardIds.length, label + ": duplicate cards");
  assert.ok(snapshot.overflow <= 1, label + ": horizontal overflow " + snapshot.overflow);
  assert.ok(snapshot.rects.every((r) => r.width > 10 && r.height > 10), label + ": collapsed card");
  assert.equal(snapshot.hidden, 0, label + ": invisible cards remain after animation");
  assert.ok(snapshot.rects.every((r, i) => i === 0 || r.top >= snapshot.rects[i - 1].top),
    label + ": row order / geometry mismatch");
  const dates = snapshot.dateValues;
  if (direction) assert.deepEqual(
    dates, [...dates].sort((a, b) => direction === "oldest" ? a.localeCompare(b) : b.localeCompare(a)),
    label + ": chronological ordering incorrect",
  );
  observations.push({ label, cards: dates.length, first: dates[0], last: dates.at(-1),
    overflow: snapshot.overflow, width: snapshot.listWidth, busy: snapshot.busy });
  return snapshot;
}

async function audit(engine, name, width, seed) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "no-preference",
      isMobile: width < 500,
      hasTouch: width < 500,
    });
    try {
      await context.addInitScript(() => {
        localStorage.setItem("echo:motion", JSON.stringify("full"));
        localStorage.setItem("echo:skin", JSON.stringify("editorial"));
        localStorage.setItem("echo:theme", JSON.stringify("light"));
      });
      const page = await context.newPage();
      const runtimeErrors = [];
      page.on("pageerror", (e) => runtimeErrors.push(String(e)));
      const prefix = name + "-" + width;
      const response = await page.goto(origin + "/feed/", {
        waitUntil: "domcontentloaded", timeout: 20000,
      });
      assert.ok(response?.ok(), prefix + ": production HTTP " + response?.status());
      await page.locator(".sort-control select").waitFor({ timeout: 15000 });
      await page.waitForFunction(
        () => !document.documentElement.classList.contains("font-wait"), { timeout: 12000 },
      );
      const original = await checkView(page, prefix + "/newest", "newest");
      await page.screenshot({ path: output + "/" + prefix + "-newest.png", animations: "disabled" });
      const load = page.locator("button.load-more");
      if (await load.count()) {
        await load.click();
        await page.waitForFunction(() => document.querySelectorAll(".feed-list .feed-item").length > 8, {
          timeout: 5000,
        });
      }
      const afterLoad = await page.locator(".feed-list .feed-item").count();
      // Record child-list changes at the moment we switch sort. A regression
      // used to display the prior loaded item count in the new order for one
      // render, then truncate it after useEffect during the animation.
      await page.evaluate(() => {
        window.__sortCounts = [];
        const root = document.querySelector(".feed-list");
        window.__sortObserver = new MutationObserver(() => {
          window.__sortCounts.push(root?.children.length || 0);
        });
        window.__sortObserver.observe(root, { childList: true });
      });
      await page.locator(".sort-control select").selectOption("oldest");
      await page.waitForURL((u) => u.searchParams.get("sort") === "oldest", { timeout: 12000 });
      const reversed = await checkView(page, prefix + "/oldest", "oldest");
      const samples = await page.evaluate(() => {
        window.__sortObserver.disconnect();
        return window.__sortCounts;
      });
      if (afterLoad > 8) assert.ok(samples.every((count) => count <= 8),
        prefix + ": sorted list briefly kept expanded page (" + samples.join(",") + ")");
      if (original.cardIds.length > 1) {
        assert.notEqual(reversed.cardIds[0], original.cardIds[0],
          prefix + ": oldest and newest unexpectedly share first item");
      }
      await page.screenshot({ path: output + "/" + prefix + "-oldest.png", animations: "disabled" });
      await page.locator(".sort-control select").selectOption("newest");
      await page.waitForURL((u) => !u.searchParams.has("sort"), { timeout: 12000 });
      const forward = await checkView(page, prefix + "/forward", "newest");
      assert.equal(forward.cardIds[0], original.cardIds[0], prefix + ": failed to restore first item");

      // Randomize harmless route order and return to the feed after each cycle.
      // There is no random sort option on Waylan; this tests random *actions*.
      for (const route of shuffled(["/projects", "/archive", "/", "/feed"], seed)) {
        // Trigger the site's own React router, not a new-document reload.
        // Hidden mobile-nav links can still be activated programmatically.
        await page.evaluate((destination) => {
          const link = [...document.querySelectorAll("#site-nav a")].find((a) =>
            a.getAttribute("href") === destination);
          if (!link) throw new Error("Missing internal route link " + destination);
          link.click();
        }, route);
        await page.waitForURL((u) => u.pathname.replace(/\\/$/, "") === (route === "/" ? "" : route), {
          timeout: 12000,
        });
        await page.waitForFunction(() => !document.documentElement.hasAttribute("data-navigation"));
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, prefix + ": route " + route + " overflow " + overflow);
        observations.push({ label: prefix + "/random-route:" + route, overflow });
      }
      assert.deepEqual(runtimeErrors, [], prefix + ": runtime exceptions");
      observations.push({ label: prefix + "/PASS", afterLoad, sortCountSnapshots: samples.length });
    } catch (error) {
      const reason = String(error?.stack || error);
      failures.push({ browser: name, width, reason });
      observations.push({ label: name + "-" + width + "/FAIL", reason });
      throw error;
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

try {
  for (const [engine, name, width, seed] of [
    [chromium, "chromium", 1440, 831],
    [firefox, "firefox", 768, 2401],
    [webkit, "webkit", 390, 9917],
  ]) await audit(engine, name, width, seed);
  console.log("LIVE_MOTION_AUDIT_PASS", JSON.stringify(observations));
} finally {
  await writeFile(output + "/observations.json", JSON.stringify({
    origin, observations, failures,
  }, null, 2));
}
