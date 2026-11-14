/** W-08/W-09/W-10: non-destructive browser QA; all admin responses are mocked. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";

const origin = "http://127.0.0.1:4175";
const out = "quality-report";
const projectPosts = JSON.parse(readFileSync(new URL("../src/generated/posts.json", import.meta.url), "utf8"))
  .filter(post => post.type === "project");
const projectPageCount = Math.min(projectPosts.length, 8);
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
            // This is a visual/motion test against a static Vite preview, not
            // a Worker. Never send a view-count POST to the missing backend;
            // WebKit can report the resulting network rejection as a pageerror
            // after navigating away, unrelated to the visual assertions.
            await page.route("**/api/views", (route) => route.fulfill({
              json: { enabled: false, views: {} },
            }));
            await page.route("**/api/posts/*/view", (route) => route.fulfill({
              json: { enabled: false, views: null },
            }));
            await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
            // The first navigation should exercise hydrated handlers, not a
            // click raced against downloading/starting the client bundle.
            await page.waitForTimeout(500);
            stage = "feed navigation";
            await page.locator("a[href='/feed']").first().click();
            await page.waitForURL(/\/feed(?:\?.*)?$/, { timeout: 15000 });
            await noOverflow(page, name + "/" + width + "/" + motion + "/feed");
            if (width === 390 && motion === "reduced") {
              stage = "phone density headers and expanded bookmark target";
              await page.evaluate(() => document.fonts.ready);
              const firstCard = page.locator(".feed-layout .feed-item").first();
              const fullHeader = await firstCard.evaluate(card => ({
                metaHeight: card.querySelector(".entry-meta").getBoundingClientRect().height,
                titleOffset: card.querySelector("h2").getBoundingClientRect().top - card.getBoundingClientRect().top,
              }));
              for (let repeat = 0; repeat < 3; repeat++) {
                await page.getByRole("button", { name: "紧凑列表", exact: true }).click();
                await page.locator(".feed-list.density-compact").waitFor();
                const compactHeader = await firstCard.evaluate(card => {
                  const meta = card.querySelector(".entry-meta").getBoundingClientRect();
                  const title = card.querySelector("h2").getBoundingClientRect();
                  const button = card.querySelector(".card-bookmark").getBoundingClientRect();
                  const box = card.getBoundingClientRect();
                  return { metaHeight: meta.height, titleOffset: title.top - box.top,
                    targetFits: button.width >= 44 && button.height >= 44 && button.top >= box.top - 1 &&
                      button.bottom <= title.top + 1 && button.left >= meta.right - 1 && button.right <= box.right + 1 };
                });
                assert.ok(compactHeader.metaHeight <= fullHeader.metaHeight + 1 &&
                  Math.abs(compactHeader.titleOffset - fullHeader.titleOffset) <= 4 && compactHeader.targetFits,
                  name + ": phone density shifts its header or overlaps the bookmark target: " + JSON.stringify({ fullHeader, compactHeader }));
                if (repeat === 0) {
                  const bookmark = firstCard.locator(".card-bookmark"), box = await bookmark.boundingBox();
                  const saved = await bookmark.getAttribute("aria-pressed");
                  // Exercise the part above the metadata row, not only the visible icon.
                  await page.mouse.click(box.x + box.width / 2, box.y + 2);
                  assert.notEqual(await bookmark.getAttribute("aria-pressed"), saved,
                    name + ": expanded bookmark target does not receive clicks");
                  await bookmark.click();
                  assert.equal(await bookmark.getAttribute("aria-pressed"), saved);
                  await page.screenshot({ path: out + "/" + name + "-390-feed-compact.png", animations: "disabled" });
                }
                await page.getByRole("button", { name: "图文 · 详细列表", exact: true }).click();
                await page.locator(".feed-list.density-full").waitFor();
              }
            }
            // Browsing routes keep the global settings button. On mobile an
            // article intentionally replaces that chrome with one reader row.
            stage = "browsing settings";
            const settingsButton = page.locator('.header-tools > button[aria-label="阅读设置"]');
            await settingsButton.click();
            const dialog = page.getByRole("dialog", { name: "阅读设置", exact: true });
            await dialog.waitFor({ state: "visible" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            stage = "article hydration";
            // Vite preview serves prerendered /post/:slug/index.html at trailing-slash
            // URLs. Cloudflare production canonicalizes back to /post/:slug.
            await page.goto(origin + "/post/a-room-on-the-internet/", { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(500);
            await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
            await noOverflow(page, name + "/" + width + "/" + motion + "/post");
            if (width <= 1024) {
              assert.equal(await page.locator(".site-header-reader").isVisible(), true,
                name + ": mobile reader lost its Waylan logo masthead");
              assert.equal(await page.locator(".site-header-reader #site-nav").isVisible(), false,
                name + ": destination navigation returned as a redundant second row");
            }
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
            // Real browser regression: returning to the archive must preserve
            // its scroll position in Chromium, Firefox and WebKit.
            if (width === 390 && motion === "reduced") {
              stage = "archive reader return and scroll restoration";
              const row = page.locator(".archive-row").nth(10);
              await row.scrollIntoViewIfNeeded();
              const before = await page.evaluate(() => window.scrollY);
              assert.ok(before > 50, name + ": archive fixture did not scroll");
              await row.click();
              await page.waitForURL(/\/post\/[^/?#]+$/, { timeout: 15000 });
              await page.locator(".reader-back").click();
              await page.waitForURL(/\/archive$/, { timeout: 15000 });
              await page.waitForFunction((position) =>
                Math.abs(window.scrollY - position) <= 24, before, { timeout: 10000 });
              assert.equal(await page.locator(".archive-row .archive-type").count(), 15,
                name + ": archive labels missing after restoring scroll");
            }
            if (width === 390 && motion === "reduced") {
              stage = "projects reader round trip";
              await page.locator('#site-nav a[href="/projects"]').click();
              await page.waitForURL(/\/projects$/, { timeout: 15000 });
              const links = page.locator(".projects-layout .post-card-link");
              assert.equal(await links.count(), projectPageCount, name + ": real project count changed unexpectedly");
              assert.equal(await page.locator(".projects-layout .site-sidebar").isVisible(), false,
                name + ": duplicate narrow-screen project sidebar");
              for (const slug of projectPosts.slice(0, 2).map(post => post.slug)) {
                const link = page.locator('.projects-layout .post-card-link[href="/post/' + slug + '"]');
                await link.scrollIntoViewIfNeeded();
                const before = await page.evaluate(() => window.scrollY);
                await link.click();
                await page.waitForURL(new RegExp("/post/" + slug + "$"), { timeout: 15000 });
                await page.locator(".reader-back").click();
                await page.waitForURL(/\/projects$/, { timeout: 15000 });
                await page.waitForFunction((y) =>
                  Math.abs(window.scrollY - y) <= 24, before, { timeout: 10000 });
              }
              const label = page.locator(".projects-layout .tag-list a").first();
              await label.click();
              await page.waitForURL(/\/feed\?tag=/, { timeout: 15000 });
            }
            if (width === 390 && motion === "reduced") {
              stage = "about navigation and scroll restoration";
              await page.locator('#site-nav a[href="/about"]').click();
              await page.waitForURL(/\/about$/, { timeout: 15000 });
              assert.equal(await page.locator(".about-details > section > h2").count(), 2,
                name + ": about independent sections have incorrect heading levels");
              assert.equal(await page.locator(".about-layout .site-sidebar").isVisible(), false,
                name + ": about appended a redundant small-screen rail");
              const social = page.locator(".about-text .social-links a").first();
              assert.equal(await social.getAttribute("target"), "_blank");
              assert.match(await social.getAttribute("rel") || "", /noopener/);
              assert.equal(await page.locator(".about-explore").count(), 0,
                name + ": About repeats a redundant end-of-page browse CTA");
              await page.locator(".about-details").scrollIntoViewIfNeeded();
              const before = await page.evaluate(() => window.scrollY);
              assert.ok(before > 100, name + ": about page did not scroll");
              // Activating an already visible sticky-header destination must
              // not let Playwright auto-scroll the old document *before* the
              // router can save the reading position.
              await page.locator('#site-nav a[href="/feed"]').evaluate((link) => link.click());
              await page.waitForURL(/\/feed$/, { timeout: 15000 });
              await page.evaluate(() => history.back());
              await page.waitForURL(/\/about$/, { timeout: 15000 });
              await page.waitForFunction((position) =>
                Math.abs(window.scrollY - position) <= 24, before, { timeout: 10000 });
              stage = "standalone privacy page";
              const privacyLink = page.locator('.site-footer .footer-links a[href="/privacy"]');
              await privacyLink.scrollIntoViewIfNeeded();
              await privacyLink.click();
              await page.waitForURL(/\/privacy$/, { timeout: 15000 });
              assert.equal(await page.locator(".privacy-page section h2").count(), 6,
                name + ": privacy notice sections missing");
              await noOverflow(page, name + "/" + width + "/privacy");
            }
            if (width === 390 && motion === "reduced") {
              stage = "404 recovery and interactive search";
              // WebKit can keep a history-restoration navigation pending when
              // the 404 document is loaded into the same page. Use a fresh tab.
              const missing = await context.newPage();
              missing.on("pageerror", (error) => errors.push("404: " + String(error)));
              await missing.route("**/api/status", (route) => route.fulfill({
                json: { notifications: false, comments: false, login: false },
              }));
              await missing.route("**/api/views", (route) => route.fulfill({
                json: { enabled: false, views: {} },
              }));
              await missing.route("**/api/posts/*/view", (route) => route.fulfill({
                json: { enabled: false, views: null },
              }));
              const errorPage = await missing.goto(origin + "/404.html", { waitUntil: "commit", timeout: 15000 });
              assert.ok(errorPage?.ok(), name + ": built 404 document not served");
              await missing.getByRole("heading", { name: "页面不存在" }).waitFor();
              await missing.waitForTimeout(400);
              await noOverflow(missing, name + "/404");
              assert.equal(await missing.locator(".not-found .lost-latest a").count(), 3);
              await missing.locator(".not-found .lost-page").click();
              await missing.locator(".not-found .echo-trail").waitFor();
              await missing.locator(".header-search").click();
              const searchDialog = missing.locator(".search-dialog[open]");
              await searchDialog.waitFor();
              assert.equal(await searchDialog.locator('[role="listbox"]').count(), 0);
              await searchDialog.locator('input[type="search"]').fill("D1");
              assert.ok(await searchDialog.locator('[role="listbox"] [role="option"]').count() > 0);
              await missing.keyboard.press("Escape");
              await searchDialog.waitFor({ state: "hidden" });
              await missing.locator('.not-found a[href="/archive"]').click();
              await missing.waitForURL(/\/archive$/, { timeout: 15000 });
              await missing.close();
            }
            // iOS Safari: focus raises the keyboard while the search dialog opens.
            // Under full motion the native top layer must not translate.
            if (name === "webkit" && width === 390 && motion === "full") {
              stage = "mobile full-motion search and keyboard-like viewport changes";
              await page.goto(origin + "/feed/", { waitUntil: "domcontentloaded" });
              await page.locator(".header-search").waitFor();
              await page.evaluate(() => window.scrollTo(0, 600));
              await page.locator(".header-search").evaluate((button) => button.click());
              const overlay = page.locator(".search-dialog[open]");
              await overlay.waitFor();
              const initial = await overlay.evaluate((dialog) => ({
                bounds: dialog.getBoundingClientRect().toJSON(),
                transforms: dialog.getAnimations().flatMap((a) =>
                  a.effect?.getKeyframes?.() || []).filter((f) => "transform" in f),
                focused: document.activeElement === dialog.querySelector('input[type="search"]'),
              }));
              assert.equal(initial.transforms.length, 0,
                "search must not slide while Safari raises the keyboard");
              assert.ok(Math.abs(initial.bounds.top) <= 1 && initial.focused,
                "search should start at the viewport top and focus the input");
              await page.setViewportSize({ width: 390, height: 540 });
              const resized = await overlay.boundingBox();
              assert.ok(resized && Math.abs(resized.y) <= 1 && Math.abs(resized.height - 540) <= 2,
                "search must remain viewport-anchored during keyboard-like resize");
              await overlay.locator('input[type="search"]').fill("D1");
              assert.ok(await overlay.locator('[role="option"]').count() > 0,
                "search results remain usable after resizing");
              await page.keyboard.press("Escape");
              await overlay.waitFor({ state: "hidden" });
            }
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
const reviewFixtures = [
  { number: 51, title: "需要审核的文章", url: "https://github.com/qa-owner/waylan-blog/pull/51",
    branch: "review/post-51", state: "open", draft: true, updatedAt: "2026-11-07T12:00:00Z",
    target: { kind: "post", file: "sample.md" } },
  { number: 52, title: "已合并的站点修改", url: "https://github.com/qa-owner/waylan-blog/pull/52",
    branch: "review/site-52", state: "merged", draft: false, updatedAt: "2026-11-07T12:00:00Z",
    target: { kind: "site" } },
  { number: 53, title: "已关闭而未合并的审核", url: "https://github.com/qa-owner/waylan-blog/pull/53",
    branch: "review/post-53", state: "closed", draft: false, updatedAt: "2026-11-07T12:00:00Z",
    target: { kind: "post", file: "sample.md" } },
];
async function adminBrowsers() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 }, colorScheme: theme,
        hasTouch: width <= 768, isMobile: width <= 768,
      });
      try {
        const page = await context.newPage();
        let mode = "guest";
        let reviewMode = false;
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.route("**/api/admin/**", (route) => {
          const url = new URL(route.request().url());
          const method = route.request().method();
          if (url.pathname === "/api/admin/session")
            return route.fulfill({ json: fakeSession(mode) });
          if (url.pathname === "/api/admin/content")
            return route.fulfill({ json: {
              ...overview, publicationMode: reviewMode ? "review-pr" : "direct",
            } });
          if (url.pathname === "/api/admin/reviews")
            return route.fulfill({ json: { reviews: reviewFixtures, truncated: false } });
          if (url.pathname === "/api/admin/status")
            return route.fulfill({ json: { head: overview.head, live: overview.live } });
          if (url.pathname === "/api/admin/post" && method === "GET")
            return route.fulfill({ json: post });
          if (url.pathname === "/api/admin/post" && (method === "PUT" || method === "DELETE"))
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
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
        await noOverflow(page, "admin/dashboard/" + width + "/" + theme);
        await page.screenshot({ path: out + "/admin-dashboard-" + width + "-" + theme + ".png" });
        // Long social values and repeated announcements are entirely local drafts.
        await page.locator(".site-card button").click();
        await page.getByRole("heading", { name: "站点资料", exact: true }).waitFor();
        await page.getByRole("button", { name: "添加一行" }).click();
        await page.getByRole("textbox", { name: "第 1 项 · 地址或邮箱" }).fill(
          "https://github.com/example/very-long-unbroken-identifier-" + "a".repeat(110));
        await page.getByRole("textbox", { name: "第 1 项 · 显示名称" }).fill("个人主页");
        await page.getByRole("button", { name: "新增公告" }).click();
        await page.getByRole("button", { name: "新增公告" }).click();
        await page.locator(".announcement-editor").first().locator("input").first().fill("长公告" + "测试".repeat(20));
        const firstNotice = page.locator(".announcement-editor").first();
        await firstNotice.locator('input[type="checkbox"]').check();
        await firstNotice.locator('input[type="checkbox"]').uncheck();
        assert.equal(await firstNotice.locator('input[type="checkbox"]').isChecked(), false,
          "withdrawing an announcement must keep it unpublished in the draft");
        await noOverflow(page, "admin/site-long/" + width + "/" + theme);
        await page.screenshot({ path: out + "/admin-site-" + width + "-" + theme + ".png" });
        const siteDialog = page.waitForEvent("dialog").then((dialog) => {
          assert.match(dialog.message(), /没有保存/);
          return dialog.accept();
        });
        await page.locator(".editor-head-main button").click();
        await siteDialog;
        await page.getByRole("heading", { name: "内容（1）" }).waitFor();
        await page.getByRole("button", { name: "写新内容" }).click();
        await page.getByRole("heading", { name: "写新内容", exact: true }).waitFor();
        await page.getByRole("textbox", { name: "标题" }).fill("未保存的新文章");
        const newPostDialog = page.waitForEvent("dialog").then((dialog) => {
          assert.match(dialog.message(), /没有保存/);
          return dialog.accept();
        });
        await page.locator(".editor-head-main button").click();
        await newPostDialog;
        await page.getByRole("heading", { name: "内容（1）" }).waitFor();
        await page.locator(".posts .link").first().click();
        await page.getByRole("heading", { name: "编辑", exact: true }).waitFor();
        await noOverflow(page, "admin/editor/" + width + "/" + theme);
        await page.screenshot({ path: out + "/admin-editor-" + width + "-" + theme + ".png" });
        if (width <= 768) {
          const touchTarget = await page.locator(".markdown-tools > button").first()
            .evaluate((button) => button.getBoundingClientRect().height);
          assert.ok(touchTarget >= 44, "admin Markdown touch target must be at least 44px");
        }
        await page.getByRole("button", { name: "预览", exact: true }).click();
        await page.getByRole("region", { name: "文章正文（Markdown）预览" }).waitFor();
        await page.getByRole("button", { name: "编辑", exact: true }).last().click();
        const imagePicker = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "上传封面" }).click();
        await (await imagePicker).setFiles({
          name: "oversized.png", mimeType: "image/png",
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        });
        await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").textContent(), /5 MB/,
          "invalid image selection must surface a readable error");
        await page.locator(".editor .field input").first().fill("修改后测试文章");
        const stayDialog = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
        await page.locator(".editor-head-main button").click();
        await stayDialog;
        await page.getByRole("heading", { name: "编辑", exact: true }).waitFor();
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").textContent(), /文件已更新/);
        await noOverflow(page, "admin/error/" + width + "/" + theme);
        if (width === 390) {
          await page.setViewportSize({ width, height: 520 });
          await noOverflow(page, "admin/short-viewport/" + width + "/" + theme);
          await page.screenshot({ path: out + "/admin-short-" + width + "-" + theme + ".png" });
        }
        await page.setViewportSize({ width, height: 900 });
        const leaveDialog = page.waitForEvent("dialog").then((dialog) => dialog.accept());
        await page.locator(".editor-head-main button").click();
        await leaveDialog;
        await page.getByRole("heading", { name: "内容（1）" }).waitFor();
        await page.getByRole("button", { name: "删除", exact: true }).last().click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
        await page.getByRole("dialog").getByRole("alert").waitFor();
        await noOverflow(page, "admin/delete-error/" + width + "/" + theme);
        await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
        if (width === 390 && theme === "light") {
          reviewMode = true;
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByRole("heading", { name: "内容审核队列" }).waitFor();
          await page.getByText("已合并 main（待确认部署）").waitFor();
          await page.getByText("已关闭，未合并").waitFor();
          await page.getByText("待审核").waitFor();
          assert.equal(await page.getByRole("button", { name: "继续编辑", exact: true }).count(), 1);
          await noOverflow(page, "admin/review-queue/" + width + "/" + theme);
          await page.screenshot({ path: out + "/admin-review-" + width + "-" + theme + ".png" });
          await page.getByRole("button", { name: "继续编辑", exact: true }).click();
          await page.getByRole("heading", { name: "编辑", exact: true }).waitFor();
          assert.match(await page.locator(".editor-save").textContent(), /提交 PR 审核/,
            "review editing must not display the direct publishing action");
        }
        assert.deepEqual(errors, [], "admin/" + width + "/" + theme + ": runtime errors");
        checked.push({ browser: "chromium", width, theme, route: "admin", ok: true });
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
