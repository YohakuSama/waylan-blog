/** Browser-only WCAG smoke audit; no user data or production APIs. */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const origin = "http://127.0.0.1:4177";
const output = "accessibility-report";
const pages = ["/", "/feed/", "/archive/", "/projects/", "/about/", "/post/a-room-on-the-internet/"];
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
