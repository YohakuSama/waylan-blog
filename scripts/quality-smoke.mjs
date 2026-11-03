/** W-08/W-09/W-10: non-destructive browser QA; all admin responses are mocked. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";

const origin = "http://127.0.0.1:4175";
const out = "quality-report";
await mkdir(out, { recursive: true });
const preview = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1",
  "--port", "4175", "--strictPort",
], { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [preview.stdout, preview.stderr])
  stream.on("data", (data) => { serverLog = (serverLog + data).slice(-2500); });
async function ready() {
  for (let retry = 0; retry < 100; retry++) {
    if (preview.exitCode !== null) throw new Error("Preview exited: " + serverLog);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview did not start: " + serverLog);
}
async function noOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(geometry.scrollWidth <= geometry.width + 1,
    label + ": horizontal overflow " + JSON.stringify(geometry));
}
const checked = [];
async function publicBrowsers() {
  for (const [name, engine] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [390, 768, 1440]) {
        for (const motion of ["full", "reduced"]) {
          const options = {
            viewport: { width, height: 900 },
            reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
          };
          if (name !== "firefox" && width < 900) Object.assign(options, { isMobile: true, hasTouch: true });
          const context = await browser.newContext(options);
          try {
            await context.addInitScript((level) => {
              localStorage.setItem("echo:motion", JSON.stringify(level));
              localStorage.setItem("echo:skin", JSON.stringify("editorial"));
              localStorage.setItem("echo:theme", JSON.stringify("light"));
            }, motion);
            const page = await context.newPage();
            const errors = [];
            let stage = "home hydration";
            page.on("pageerror", (error) => errors.push(stage + " @ " + page.url() + ": " + String(error)));
            page.on("console", (event) => {
              if (event.type() === "error" && /Uncaught|Unhandled/i.test(event.text()))
                errors.push(event.text());
            });
            await page.route("**/api/status", (route) => route.fulfill({
              json: { notifications: false, comments: false, login: false },
            }));
            // The Vite static preview has no Worker view-count endpoint.
            // Intercept this best-effort POST so WebKit navigation is tested
            // without an in-flight request to a nonexistent preview API.
            await page.route("**/api/posts/*/view", (route) =>
              route.fulfill({ json: { enabled: false, views: null } }));
            await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
            // The first navigation should exercise hydrated handlers, not a
            // click raced against downloading/starting the client bundle.
            await page.waitForTimeout(500);
            stage = "feed navigation";
            await page.locator("a[href='/feed']").first().click();
            await page.waitForURL(/\/feed(?:\?.*)?$/, { timeout: 15000 });
            await noOverflow(page, name + "/" + width + "/" + motion + "/feed");
            stage = "article hydration";
            // Vite preview serves prerendered /post/:slug/index.html at trailing-slash
            // URLs. Cloudflare production canonicalizes back to /post/:slug.
            await page.goto(origin + "/post/a-room-on-the-internet/", { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(500);
            await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
            await noOverflow(page, name + "/" + width + "/" + motion + "/post");
            stage = "article settings";
            const settingsButton = page.locator('.header-tools > button[aria-label="阅读设置"]');
            await settingsButton.click();
            const dialog = page.getByRole("dialog", { name: "阅读设置", exact: true });
            await dialog.waitFor({ state: "visible" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            // Simulate navigation churn with real (not reduced) transitions.
            stage = "archive navigation";
            await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(500);
            await page.locator("a[href='/archive']").first().click();
            await page.waitForURL(/\/archive$/, { timeout: 15000 });
            await page.screenshot({
              path: out + "/" + name + "-" + width + "-" + motion + ".png",
              animations: "disabled",
            });
            assert.deepEqual(errors, [], name + "/" + width + "/" + motion + ": runtime errors");
            checked.push({ browser: name, width, motion, ok: true });
          } finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
}
function fakeSession(mode) {
  const user = { login: "qa-owner", avatarUrl: "/avatar.svg", url: "https://github.com/qa-owner" };
  if (mode === "unconfigured") return { configured: false, missing: ["GITHUB_CONTENT_TOKEN"], user: null, admin: false };
  if (mode === "guest") return { configured: true, missing: [], user: null, admin: false };
  return { configured: true, missing: [], user, admin: mode === "admin", csrf: "qa-csrf" };
}
const overview = {
  repo: { name: "qa-owner/waylan-blog", branch: "main" },
  head: { oid: "qa-head", date: "2026-11-03T00:00:00Z" },
  live: "qa-head",
  site: { oid: "qa-site", data: {
    name: "Waylan QA", author: "QA", tagline: "演示",
    description: "演示", intro: "", profileTags: [], socials: [], avatar: "",
  } },
  about: { oid: "qa-about", text: "" },
  topics: [{ id: "dev", name: "开发" }],
  posts: [{
    file: "sample.md", oid: "qa-post", title: "后台测试文章",
    id: "sample", slug: "sample", type: "article", date: "2026-11-03", topic: "dev",
  }],
  discussions: { enabled: false, pending: [] },
};
const post = {
  file: "sample.md", oid: "qa-post",
  data: { title: "后台测试文章", id: "sample", slug: "sample",
    type: "article", date: "2026-11-03", topic: "dev", tags: [] },
  body: "## 测试正文\n\n这段文字用于响应式编辑器检查。",
};
async function adminBrowsers() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1024, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        let mode = "guest";
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.route("**/api/admin/**", (route) => {
          const url = new URL(route.request().url());
          const method = route.request().method();
          if (url.pathname === "/api/admin/session")
            return route.fulfill({ json: fakeSession(mode) });
          if (url.pathname === "/api/admin/content")
            return route.fulfill({ json: overview });
          if (url.pathname === "/api/admin/status")
            return route.fulfill({ json: { head: overview.head, live: overview.live } });
          if (url.pathname === "/api/admin/post" && method === "GET")
            return route.fulfill({ json: post });
          if (url.pathname === "/api/admin/post" && method === "PUT")
            return route.fulfill({ status: 409, json: {
              code: "CONFLICT", message: "文件已更新，请刷新后重试",
            } });
          return route.fulfill({ status: 404, json: {
            code: "TEST_NOT_MOCKED", message: "测试未模拟此接口",
          } });
        });
        await page.goto(origin + "/admin/", { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "登录后台" }).waitFor();
        await noOverflow(page, "admin/guest/" + width);
        if (width === 390) {
          // The independent admin page should follow OS changes unless a
          // persisted theme was explicitly chosen in another browser tab.
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
          await page.emulateMedia({ colorScheme: "dark" });
          await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
          await page.evaluate(() => {
            localStorage.setItem("echo:theme", JSON.stringify("light"));
            window.dispatchEvent(new StorageEvent("storage", { key: "echo:theme" }));
          });
          await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
          await page.emulateMedia({ colorScheme: "light" });
          await page.emulateMedia({ colorScheme: "dark" });
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),
            "light", "explicit light preference must override the dark OS setting");
          await page.evaluate(() => {
            localStorage.removeItem("echo:theme");
            window.dispatchEvent(new StorageEvent("storage", { key: "echo:theme" }));
          });
          await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
        }
        mode = "unconfigured";
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "后台还没有配置完成" }).waitFor();
        await noOverflow(page, "admin/unconfigured/" + width);
        mode = "denied";
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "没有管理权限" }).waitFor();
        await noOverflow(page, "admin/denied/" + width);
        mode = "admin";
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "内容（1）" }).waitFor();
        await noOverflow(page, "admin/dashboard/" + width);
        await page.screenshot({ path: out + "/admin-dashboard-" + width + ".png" });
        await page.locator(".posts .link").first().click();
        await page.getByRole("heading", { name: "编辑", exact: true }).waitFor();
        await noOverflow(page, "admin/editor/" + width);
        await page.screenshot({ path: out + "/admin-editor-" + width + ".png" });
        await page.locator(".editor .field input").first().fill("修改后测试文章");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").textContent(), /文件已更新/);
        assert.deepEqual(errors, [], "admin/" + width + ": runtime errors");
        checked.push({ browser: "chromium", width, route: "admin", ok: true });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
try {
  await ready();
  await publicBrowsers();
  await adminBrowsers();
  console.log("Quality checks passed:", checked.length,
    "cross-browser motion/viewport and admin states.");
} catch (error) {
  await writeFile(out + "/failure.txt", String(error?.stack || error));
  throw error;
} finally {
  await writeFile(out + "/summary.json", JSON.stringify(checked, null, 2));
  preview.kill("SIGTERM");
  preview.stdout.destroy(); preview.stderr.destroy();
}
