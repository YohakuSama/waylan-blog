/** Isolated front-end feature matrix. Uses local storage fixtures and mocked API only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4182";
const out = "functional-ui-report";
const posts = JSON.parse(readFileSync(new URL("../src/generated/posts.json", import.meta.url), "utf8"));
const post = posts.find((entry) => entry.slug === "a-room-on-the-internet") || posts[0];
assert.ok(post, "missing fixture post");
const variants = [
  ["editorial", "light"], ["editorial", "dark"],
  ["terminal", "light"], ["terminal", "dark"],
];
const widths = [1440, 768, 390];
const report = [];
await mkdir(out, { recursive: true });

const server = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4182", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-2500); });
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Preview stopped: " + serverLog);
    try { if ((await fetch(origin + "/")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview unavailable: " + serverLog);
}
const filename = (label, state) => out + "/" + label + "-" + state + ".png";
async function capture(page, label, state) {
  await page.screenshot({ path: filename(label, state), animations: "disabled" });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, label + "/" + state + " overflows horizontally: " + overflow);
}
async function contained(page, selector, label) {
  const box = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, label + ": missing element");
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1,
    label + ": panel outside viewport: " + JSON.stringify(box));
}
async function closeWithEscape(page, selector) {
  await page.keyboard.press("Escape");
  await page.locator(selector).waitFor({ state: "hidden" });
}
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const [skin, theme] of variants) for (const width of widths) {
    const label = skin + "-" + theme + "-" + width;
    const context = await browser.newContext({
      viewport: { width, height: 900 }, reducedMotion: "reduce",
      hasTouch: width <= 390, isMobile: width <= 390,
    });
    try {
      await context.addInitScript(({ skin, theme }) => {
        localStorage.setItem("echo:skin", JSON.stringify(skin));
        localStorage.setItem("echo:theme", JSON.stringify(theme));
      }, { skin, theme });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let signedIn = false, subscribed = true, mode = "ready";
      await page.route("**/api/session", (route) => route.fulfill({
        json: signedIn
          ? { user: { login: "qa-user" }, csrf: "qa-token", moderator: false }
          : { user: null },
      }));
      await page.route("**/api/status", (route) => mode === "error"
        ? route.fulfill({ status: 503, json: { message: "mock outage" } })
        : route.fulfill({ json: { notifications: true, comments: false } }));
      await page.route("**/api/notifications", (route) => {
        if (route.request().method() === "POST") {
          const body = JSON.parse(route.request().postData() || "{}");
          if (typeof body.subscribed === "boolean") subscribed = body.subscribed;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: {
          enabled: true, subscribed, unread: 1,
          items: [{ id: "qa-reply", actor: "qa-author", slug: post.slug,
            title: post.title, commentId: "qa-comment", kind: "reply",
            time: 1790000000, read: false }],
        } });
      });
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });

      // Search: initial suggestions, populated list, empty state, Escape and focus restoration.
      await page.locator(".header-search").click();
      const search = page.locator(".search-dialog[open]");
      await search.waitFor({ state: "visible" });
      assert.ok(await search.locator(".search-suggestions button").count() > 0,
        label + ": missing suggested searches");
      await contained(page, ".search-dialog[open]", label + "/search");
      await capture(page, label, "search-suggestions");
      const input = search.locator('input[type="search"]');
      await input.fill("D1");
      assert.ok(await search.locator('[role="option"]').count() > 0, label + ": no results");
      await input.press("ArrowDown");
      assert.match(await input.getAttribute("aria-activedescendant") || "", /search-option-/);
      await capture(page, label, "search-results");
      await input.fill("query-with-no-matching-articles-9743");
      await search.locator(".search-empty-state").waitFor();
      await capture(page, label, "search-empty");
      await closeWithEscape(page, ".search-dialog[open]");
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("header-search")), true,
        label + ": search focus not restored");

      // Reading list: empty, saved entry, single removal and two-press clearing.
      await page.locator(".shelf-trigger").click();
      await page.locator(".shelf-dialog[open]").waitFor();
      assert.ok(await page.locator(".shelf-empty").isVisible(), label + ": missing empty shelf");
      await capture(page, label, "shelf-empty");
      await closeWithEscape(page, ".shelf-dialog[open]");
      await page.evaluate((slug) =>
        localStorage.setItem("waylan:reading-list:v1", JSON.stringify([slug])), post.slug);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".shelf-trigger").click();
      await page.locator(".shelf-items li").first().waitFor();
      await capture(page, label, "shelf-saved");
      await page.locator(".shelf-items .icon-button").first().click();
      assert.ok(await page.locator(".shelf-empty").isVisible(), label + ": remove did not update list");
      await closeWithEscape(page, ".shelf-dialog[open]");
      await page.evaluate((slug) =>
        localStorage.setItem("waylan:reading-list:v1", JSON.stringify([slug])), post.slug);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".shelf-trigger").click();
      await page.getByRole("button", { name: "清空清单" }).click();
      assert.ok(await page.getByRole("button", { name: "再按一次清空" }).isVisible());
      await page.getByRole("button", { name: "再按一次清空" }).click();
      assert.equal(await page.evaluate(() => localStorage.getItem("waylan:reading-list:v1")), "[]");
      await closeWithEscape(page, ".shelf-dialog[open]");

      // Appearance and local-only font/highlight management.
      await page.evaluate((id) =>
        localStorage.setItem("echo:marks:" + id, JSON.stringify([{ selection: "QA only" }])), post.id);
      await page.locator(".settings-button").click();
      const settings = page.locator(".settings-dialog[open]");
      await settings.waitFor();
      assert.equal(await settings.locator('input[name="skin"]:checked').inputValue(), skin);
      assert.equal(await settings.locator('input[name="theme"]:checked').inputValue(), theme);
      assert.ok(await settings.getByText("共 1 处").isVisible());
      await capture(page, label, "settings-highlights");
      await settings.locator(".reader-font-choices label").first().click();
      assert.equal(await page.evaluate(() => localStorage.getItem("echo:font-size")), "16");
      await settings.getByRole("button", { name: "清空所有私人划线" }).click();
      await settings.getByRole("button", { name: "再按一次，永久清空" }).click();
      assert.equal(await page.evaluate((id) => localStorage.getItem("echo:marks:" + id)), null);
      await closeWithEscape(page, ".settings-dialog[open]");

      // Mocked GitHub logged-out/authorized inbox; no OAuth navigation or real user API.
      await page.locator(".notification-trigger").click();
      const inbox = page.locator(".notification-popover");
      await inbox.getByRole("button", { name: "使用 GitHub 登录" }).waitFor();
      await contained(page, ".notification-popover", label + "/guest-inbox");
      await capture(page, label, "notification-guest");
      await closeWithEscape(page, ".notification-popover");
      signedIn = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.locator(".notification-trigger").click();
      await inbox.locator(".notification-item.unread").first().waitFor();
      assert.equal(await inbox.locator(".notification-foot button").getAttribute("aria-pressed"), "true");
      await capture(page, label, "notification-unread");
      await inbox.locator(".notification-foot button").click();
      // Subscription is persisted through an async mocked POST: wait for the
      // visible settled state instead of asserting during the busy transition.
      await page.waitForFunction(() =>
        document.querySelector(".notification-foot button")?.getAttribute("aria-pressed") === "false",
        null, { timeout: 8000 });
      // A keyboard user may Tab out of a nonmodal popover without leaving it stranded.
      await page.locator("main").focus();
      await inbox.waitFor({ state: "hidden" });
      assert.deepEqual(errors, [], label + ": JavaScript errors");
      report.push({ label, states: 8, pass: true });
    } catch (error) {
      report.push({ label, pass: false, error: String(error?.stack || error) });
      const page = context.pages()[0];
      if (page) await page.screenshot({ path: filename(label, "failure"), animations: "disabled" }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }

  // High-risk small/short viewports: no controls may disappear below the screen.
  for (const [width, height] of [[320, 568], [390, 480], [768, 500]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    try {
      await context.addInitScript(() => {
        localStorage.setItem("echo:skin", '"editorial"');
        localStorage.setItem("echo:theme", '"light"');
      });
      const page = await context.newPage();
      await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
      await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: true } }));
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await page.locator(".notification-trigger").click();
      await page.locator(".notification-popover").waitFor();
      await contained(page, ".notification-popover", "short/" + width + "/" + height);
      await page.screenshot({ path: filename("short-" + width + "-" + height, "notification"), animations: "disabled" });
      await closeWithEscape(page, ".notification-popover");
      await page.locator(".header-search").click();
      await contained(page, ".search-dialog[open]", "short-search/" + width + "/" + height);
      await closeWithEscape(page, ".search-dialog[open]");
      // Generated public notices are empty. Inject a pure test fixture for CSS
      // layout only; React announcement markup and storage are tested separately.
      await page.evaluate(() => {
        const host = document.createElement("aside");
        host.className = "site-announcement-bar priority-urgent";
        host.innerHTML = '<div class="site-announcement-inner">' +
          '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"></svg>' +
          '<span class="site-announcement-priority">紧急公告</span>' +
          '<strong class="site-announcement-title">测试通知：请查看维护安排</strong>' +
          '<button class="site-announcement-open">查看详情</button>' +
          '<button class="site-announcement-dismiss" aria-label="不再显示">×</button></div>';
        document.querySelector(".site-body")?.prepend(host);
      });
      assert.equal(await page.locator(".site-announcement-priority").evaluate(
        (node) => getComputedStyle(node).display !== "none"), true);
      await page.screenshot({ path: filename("short-" + width + "-" + height, "announcement-fixture"), animations: "disabled" });
      report.push({ label: "short-" + width + "-" + height, pass: true });
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await writeFile(out + "/results.json", JSON.stringify(report, null, 2));
}
