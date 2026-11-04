/** Browser-only WCAG smoke audit; no user data or production APIs. */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const origin = "http://127.0.0.1:4177";
const output = "accessibility-report";
const pages = ["/", "/feed/", "/archive/", "/projects/", "/about/", "/post/a-room-on-the-internet/", "/404.html"];
const themes = ["light", "dark"];
const skins = ["editorial", "terminal"];
const widths = [390, 1440];
const report = [];
const preview = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "preview",
  "--host", "127.0.0.1", "--port", "4177", "--strictPort",
], { stdio: ["ignore", "pipe", "pipe"] });
let outputText = "";
for (const stream of [preview.stdout, preview.stderr])
  stream.on("data", (data) => { outputText = (outputText + data).slice(-3000); });
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (preview.exitCode !== null) throw new Error("Vite preview exited: " + outputText);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Vite preview failed: " + outputText);
}
async function scan(page, label) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).withTags([
    "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa",
  ]).exclude(".hero-visual").analyze();
  const violations = result.violations.map((issue) => ({
    id: issue.id,
    impact: issue.impact,
    help: issue.help,
    urls: issue.helpUrl,
    nodes: issue.nodes.map((node) => ({
      target: node.target,
      failure: node.failureSummary,
    })).slice(0, 12),
    totalNodes: issue.nodes.length,
  }));
  report.push({ label, violations });
  if (violations.length)
    console.log("Accessibility observations for " + label + ": " +
      violations.map((v) => v.id + "(" + v.impact + "," + v.totalNodes + ")").join(" "));
}
try {
  await mkdir(output, { recursive: true });
  await ready();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of widths) for (const skin of skins) for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      try {
        await context.addInitScript(({ skin, theme }) => {
          localStorage.setItem("echo:skin", JSON.stringify(skin));
          localStorage.setItem("echo:theme", JSON.stringify(theme));
          localStorage.setItem("echo:motion", JSON.stringify("reduced"));
        }, { skin, theme });
        const page = await context.newPage();
        await page.route("**/api/status", (route) => route.fulfill({
          json: { notifications: false, comments: false },
        }));
        await page.route("**/api/session", (route) => route.fulfill({
          json: { user: null },
        }));
        for (const path of pages) {
          await page.goto(origin + path, { waitUntil: "domcontentloaded" });
          await page.locator("main").first().waitFor({ state: "visible" });
          await scan(page, width + "/" + skin + "/" + theme + "/" + path);
        }
      } finally { await context.close(); }
    }
    // Audit the open states that initial-page-only axe runs cannot see.
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      try {
        await context.addInitScript(() => {
          localStorage.setItem("echo:motion", JSON.stringify("reduced"));
        });
        const page = await context.newPage();
        await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
        await page.route("**/api/status", (route) => route.fulfill({
          json: { comments: false, notifications: false },
        }));
        await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
        await page.locator(".header-search").click();
        const search = page.locator(".search-dialog[open]");
        await search.waitFor();
        await scan(page, width + "/search/empty");
        await search.locator('input[type="search"]').fill("D1");
        await search.locator('[role="option"]').first().waitFor();
        await scan(page, width + "/search/results");
        await search.locator('input[type="search"]').fill("unlikely-search-token-20261104");
        await search.locator(".search-empty-state").waitFor();
        await scan(page, width + "/search/no-match");
        await page.keyboard.press("Escape");
        await search.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "阅读设置" }).click();
        const settings = page.getByRole("dialog", { name: "阅读设置" });
        await settings.waitFor();
        await scan(page, width + "/settings/open");
        await settings.getByRole("button", { name: "关闭" }).click();
        await settings.waitFor({ state: "hidden" });
        await page.locator(".shelf-trigger").click();
        const shelf = page.getByRole("dialog", { name: "阅读清单" });
        await shelf.waitFor();
        await scan(page, width + "/reading-shelf/empty");
        await shelf.getByRole("button", { name: "关闭" }).click();
        await shelf.waitFor({ state: "hidden" });
        await page.locator(".notification-trigger").click();
        const notifications = page.getByRole("dialog", { name: "消息通知" });
        await notifications.waitFor();
        await scan(page, width + "/notification/disabled");
      } finally { await context.close(); }
    }
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        await page.route("**/api/admin/session", (route) => route.fulfill({
          json: { configured: true, missing: [], admin: false, user: null },
        }));
        await page.goto(origin + "/admin/", { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "登录后台" }).waitFor();
        await scan(page, width + "/admin/guest");
      } finally { await context.close(); }
    }
    // Logged-in admin screens use isolated mock responses; nothing is written.
    const dashboard = {
      repo: { name: "qa-owner/waylan-blog", branch: "main" },
      head: { oid: "qa-head", date: "2026-11-03T00:00:00Z" },
      live: "qa-head",
      site: { oid: "qa-site", data: {
        name: "Waylan QA", author: "QA", tagline: "演示",
        description: "演示", intro: "", profileTags: [], socials: [], avatar: "",
      } },
      about: { oid: "qa-about", text: "" },
      topics: [{ id: "dev", name: "开发" }],
      posts: [{ file: "sample.md", oid: "qa-post", title: "后台测试文章",
        id: "sample", slug: "sample", type: "article", date: "2026-11-03", topic: "dev" }],
      discussions: { enabled: false, pending: [] },
    };
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        await page.route("**/api/admin/**", (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === "/api/admin/session")
            return route.fulfill({ json: { configured: true, missing: [], admin: true, csrf: "qa-csrf",
              user: { login: "qa-owner", avatarUrl: "/avatar.svg", url: "https://github.com/qa-owner" } } });
          if (url.pathname === "/api/admin/content") return route.fulfill({ json: dashboard });
          if (url.pathname === "/api/admin/status")
            return route.fulfill({ json: { head: dashboard.head, live: dashboard.live } });
          if (url.pathname === "/api/admin/post" && route.request().method() === "GET")
            return route.fulfill({ json: {
              file: "sample.md", oid: "qa-post",
              data: { title: "后台测试文章", id: "sample", slug: "sample",
                type: "article", date: "2026-11-03", topic: "dev", tags: [] },
              body: "## 测试正文\n\n这段文字用于无障碍编辑器审查。",
            } });
          return route.fulfill({ status: 404, json: { code: "NOT_MOCKED", message: "测试接口未模拟" } });
        });
        await page.goto(origin + "/admin/", { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "内容（1）" }).waitFor();
        await scan(page, width + "/admin/dashboard");
        await page.locator(".posts .link").first().click();
        await page.getByRole("heading", { name: "编辑", exact: true }).waitFor();
        await page.locator('textarea[aria-label="文章正文（Markdown）"]').waitFor();
        await scan(page, width + "/admin/editor");
        await page.locator(".editor-head button").first().click();
        await page.locator(".site-card button").click();
        await page.getByRole("heading", { name: "站点资料", exact: true }).waitFor();
        await page.locator('textarea[aria-label="关于页正文（Markdown）"]').waitFor();
        await scan(page, width + "/admin/site");
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  const blocking = report.flatMap((entry) =>
    entry.violations.filter((issue) => issue.impact === "critical" || issue.impact === "serious")
      .map((issue) => entry.label + ": " + issue.id + " (" + issue.impact + ")"));
  if (blocking.length) throw new Error(
    "Serious WCAG findings (" + blocking.length + " page/rule combinations): " + blocking.slice(0, 15).join("; "),
  );
  console.log("Accessibility automated checks passed across " + report.length +
    " page/theme/skin/viewport combinations. Manual WCAG and screen-reader review remains necessary.");
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(output + "/axe-report.json", JSON.stringify(report, null, 2));
  preview.kill("SIGTERM");
  preview.stdout.destroy(); preview.stderr.destroy();
}
