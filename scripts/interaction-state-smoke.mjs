/** Non-destructive interaction state-machine QA: forward, reverse, random, repeated. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";
const base = "http://127.0.0.1:4179", output = "interaction-report";
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4179", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-2500); });
const results = [], failures = [];
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Preview exited: " + serverLog);
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("Preview could not start: " + serverLog);
}
function shuffle(list, seed) {
  const result = [...list]; let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (1664525 * state + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
async function step(label, page, action) {
  try {
    await action();
    results.push({ label, url: page.url(), pass: true });
  } catch (error) {
    failures.push({ label, url: page.url(), reason: String(error?.stack || error) });
    await page.screenshot({ path: output + "/failure-" + failures.length + ".png", animations: "disabled" }).catch(() => {});
    throw error;
  }
}
async function navigate(page, pathname) {
  const link = page.locator('#site-nav a[href="' + pathname + '"]');
  if (await link.isVisible()) await link.click();
  else await page.locator('.site-footer a[href="' + pathname + '"]').first().click();
  await page.waitForURL((url) => url.pathname === pathname, { timeout: 12000 });
}
async function search(page, keyword, behavior) {
  await page.locator(".header-search").click();
  const dialog = page.getByRole("dialog", { name: "搜索", exact: true });
  await dialog.waitFor({ state: "visible" });
  const input = dialog.getByRole("combobox", { name: "全文搜索" });
  await input.fill(keyword);
  await page.waitForTimeout(70);
  if (behavior === "submit") {
    await input.press("Enter");
    await page.waitForURL((url) => url.pathname === "/feed" && url.searchParams.get("q") === keyword, { timeout: 12000 });
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".query-chip").count(), 1);
    assert.equal(await page.locator(".reader-prose").count(), 0, "search should not open an article");
  } else if (behavior === "select") {
    const option = dialog.getByRole("option").first();
    const path = await option.getAttribute("href");
    assert.ok(path?.startsWith("/post/"));
    await option.click();
    await page.waitForURL((url) => url.pathname === path, { timeout: 12000 });
    await dialog.waitFor({ state: "hidden" });
    await page.locator(".reader-prose").waitFor({ state: "visible" });
  } else if (behavior === "cancel") {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
}
async function scenario(engine, name, width, motion, seed) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height: 860 },
      reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
    });
    try {
      await context.addInitScript(({ motion, skin, theme }) => {
        localStorage.setItem("echo:motion", JSON.stringify(motion));
        localStorage.setItem("echo:skin", JSON.stringify(skin));
        localStorage.setItem("echo:theme", JSON.stringify(theme));
        window.__qaHistory = [];
        const push = history.pushState.bind(history);
        history.pushState = (state, unused, url) => {
          window.__qaHistory.push(String(url || ""));
          return push(state, unused, url);
        };
      }, { motion, skin: width < 500 ? "terminal" : "editorial", theme: width < 500 ? "dark" : "light" });
      const page = await context.newPage(), popups = [], errors = [];
      context.on("page", (p) => { if (p !== page) popups.push(p.url()); });
      page.on("pageerror", (error) => errors.push(String(error)));
      const prefix = name + "/" + width + "/" + motion;
      await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: false, comments: false } }));
      await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "搜索（Ctrl K）" }).waitFor();
      await page.waitForFunction(() => !document.documentElement.classList.contains("font-wait"));
      await step(prefix + "/search-submit-no-extra-actions", page, async () => {
        const before = await page.evaluate(() => window.__qaHistory.length);
        await search(page, "静态", "submit");
        assert.equal((await page.evaluate(() => window.__qaHistory.length)) - before, 1,
          "one search submit must make exactly one history entry");
        assert.deepEqual(popups, [], "search must never open extra tabs");
      });
      await step(prefix + "/reverse-and-explicit-result", page, async () => {
        await page.goBack();
        await page.waitForURL((url) => url.pathname === "/");
        await search(page, "静态", "select");
        assert.deepEqual(popups, []);
      });
      await step(prefix + "/no-result-and-history", page, async () => {
        await page.goBack();
        await page.waitForURL((url) => url.pathname === "/");
        await search(page, "impossible_query_24681234", "submit");
        await page.getByText("没有找到符合条件的内容。").waitFor();
        await page.goBack();
        await page.waitForURL((url) => url.pathname === "/");
      });
      await step(prefix + "/modal-interleave", page, async () => {
        await page.getByRole("button", { name: "阅读设置" }).click();
        const dialog = page.getByRole("dialog", { name: "阅读设置" });
        await dialog.waitFor({ state: "visible" });
        await page.keyboard.press("Control+k");
        assert.equal(await page.getByRole("dialog", { name: "搜索" }).count(), 0);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.locator(".shelf-trigger").click();
        const shelf = page.getByRole("dialog", { name: "阅读清单" });
        await shelf.waitFor({ state: "visible" });
        await page.keyboard.press("Escape");
        await shelf.waitFor({ state: "hidden" });
        await search(page, "静态", "cancel");
        assert.equal(new URL(page.url()).pathname, "/");
      });
      await step(prefix + "/triple-tap-dedup", page, async () => {
        const before = await page.evaluate(() => window.__qaHistory.length);
        await page.evaluate(() => {
          const link = document.querySelector('#site-nav a[href="/feed"]');
          if (!link) throw new Error("Missing feed destination");
          link.click(); link.click(); link.click();
        });
        await page.waitForURL((url) => url.pathname === "/feed", { timeout: 12000 });
        await page.waitForTimeout(100);
        assert.equal((await page.evaluate(() => window.__qaHistory.length)) - before, 1);
      });
      await step(prefix + "/random-route-order", page, async () => {
        for (const pathname of shuffle(["/archive", "/projects", "/about", "/", "/feed"], seed)) {
          await navigate(page, pathname);
          assert.equal(new URL(page.url()).pathname, pathname);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 1, pathname + " horizontal overflow: " + overflow);
        }
      });
      await step(prefix + "/sort-topic-reverse-forward", page, async () => {
        if (new URL(page.url()).pathname !== "/feed") await navigate(page, "/feed");
        await page.locator(".sort-control select").selectOption("oldest");
        await page.waitForURL((url) => url.searchParams.get("sort") === "oldest", { timeout: 12000 });
        const notes = page.locator(".filter-tabs button").filter({ hasText: "随笔" });
        const topicSelect = page.locator(".topic-select select");
        if ((await notes.count()) || (await topicSelect.count())) {
          // The theme tabs are intentionally hidden at narrow widths.
          // Exercise the actual mobile select rather than clicking hidden UI.
          if (await notes.first().isVisible()) await notes.first().click();
          else await topicSelect.selectOption("notes");
          await page.waitForURL((url) => url.searchParams.get("topic") === "notes", { timeout: 12000 });
          assert.equal(new URL(page.url()).searchParams.get("sort"), "oldest");
          await page.goBack();
          await page.waitForURL((url) => url.searchParams.get("sort") === "oldest" && !url.searchParams.has("topic"), { timeout: 12000 });
          await page.goForward();
          await page.waitForURL((url) => url.searchParams.get("topic") === "notes", { timeout: 12000 });
        }
      });
      await step(prefix + "/invalid-filter-link", page, async () => {
        // The previous sort navigation may still be animating; filter clicks are intentionally ignored until it settles.
        await page.waitForFunction(() => !document.documentElement.hasAttribute("data-list-busy"));
        // Exercise the actual client router without coupling this check to a full-page reload.
        await page.evaluate(() => {
          const link = document.createElement("a");
          link.href = "/feed?topic=missing-topic&sort=invalid-order";
          document.body.appendChild(link);
          link.click();
          link.remove();
        });
        await page.waitForURL(
          (url) => url.pathname === "/feed" &&
            url.searchParams.get("topic") === "missing-topic" &&
            url.searchParams.get("sort") === "invalid-order",
          { timeout: 12000 },
        );
        await page.waitForFunction(() =>
          document.querySelector(".feed-result-line")?.textContent?.includes("全部主题"),
        );
        assert.equal(await page.locator(".topic-select select").inputValue(), "all");
        assert.equal(await page.locator(".sort-control select").inputValue(), "newest");
        assert.equal(await page.locator(".empty-state").count(), 0, "invalid filters must not hide published posts");
      });
      assert.deepEqual(errors, [], "uncaught browser errors");
      assert.deepEqual(popups, [], "no extra windows were created");
      results.push({ label: prefix + "/all", pass: true });
    } finally { await context.close(); }
  } finally { await browser.close(); }
}
try {
  await ready();
  for (const [name, engine, width, motion, seed] of [
    ["chromium", chromium, 390, "reduced", 1103],
    ["firefox", firefox, 768, "reduced", 2417],
    ["webkit", webkit, 1440, "full", 99173],
    ["chromium", chromium, 1440, "full", 22871],
  ]) await scenario(engine, name, width, motion, seed);
  console.log("Interaction state-machine QA passed:", results.length,
    "cases including search, reverse, random, triple tap and modal interleaving.");
} finally {
  await writeFile(output + "/results.json", JSON.stringify({ results, failures }, null, 2));
  server.kill("SIGTERM");
  server.stdout.destroy();
  server.stderr.destroy();
}
