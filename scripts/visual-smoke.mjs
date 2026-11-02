/**
 * Real-browser viewport smoke test for the public site after npm run check.
 * Executed by CI with a temporary Playwright install (not shipped to production).
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const out = "visual-report";
await mkdir(out, { recursive: true });

const preview = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
for (const stream of [preview.stdout, preview.stderr])
  stream.on("data", (chunk) => { serverLog += String(chunk).slice(-1000); });

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (preview.exitCode !== null) throw new Error("Preview stopped: " + serverLog);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview not ready: " + serverLog);
}

const results = [];
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1, reducedMotion: "reduce" });
  await page.addInitScript(() => { window.__WAYLAN_HYDRATION_DIAGNOSTIC__ = true; });
  const errors = [];
  page.on("pageerror", (error) => errors.push({ route: new URL(page.url()).pathname, message: error.message }));


  for (const width of [1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/feed", "/archive"]) {
      await page.goto(origin + route, { waitUntil: "domcontentloaded" });
      await page.locator("main").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const rect = (el) => {
          if (!el) return null;
          const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
          return { left, top, right, bottom, width, height };
        };
        const nav = document.querySelector("#site-nav");
        const navVisible = nav && getComputedStyle(nav).display !== "none";
        return {
          viewport: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          brand: rect(document.querySelector(".brand")),
          nav: navVisible ? rect(nav) : null,
          tools: rect(document.querySelector(".header-tools")),
          column: rect(document.querySelector(".content-grid .feed-column")),
          sidebar: rect(document.querySelector(".content-grid .site-sidebar")),
          types: [...document.querySelectorAll(".type-tabs .type-tab")].map(rect),
          years: document.querySelectorAll(".timeline-year-nav a").length,
          archiveRows: document.querySelectorAll(".archive-row").length,
          archiveFilterCount: document.querySelectorAll(".archive-main .type-tabs").length,
        };
      });
      const label = `${route === "/" ? "home" : route.slice(1)}-${width}`;
      await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
      assert.ok(geometry.documentWidth <= geometry.viewport + 2,
        `${label}: horizontal overflow ${geometry.documentWidth} vs ${geometry.viewport}`);
      if (width > 860 && geometry.nav) {
        assert.ok(geometry.brand.right <= geometry.nav.left + 3,
          `${label}: brand intersects desktop navigation`);
        assert.ok(geometry.nav.right <= geometry.tools.left + 3,
          `${label}: navigation intersects header actions`);
      }
      if (route === "/feed") {
        assert.equal(geometry.types.length, 6, `${label}: missing content filters`);
        assert.ok(geometry.types.every((tab) => tab.left >= -1 && tab.right <= geometry.viewport + 1),
          `${label}: content filter clipped by viewport`);
      }
      if (route === "/archive") {
        assert.equal(geometry.archiveFilterCount, 0, `${label}: duplicate archive filters`);
        assert.ok(geometry.years > 0 && geometry.archiveRows > 0,
          `${label}: missing timeline years or article rows`);
      }
      if (geometry.column && geometry.sidebar) {
        if (width > 1200) {
          assert.ok(geometry.column.right <= geometry.sidebar.left + 2,
            `${label}: sidebar overlaps desktop feed`);
        } else {
          assert.ok(geometry.column.bottom <= geometry.sidebar.top + 2,
            `${label}: sidebar must appear below the main content`);
        }
      }
      results.push({ route, width, ...geometry });
      if (errors.length) {
        const traces = await page.evaluate(() => window.__WAYLAN_HYDRATION_TRACE__ || []);
        console.error("Hydration trace:", JSON.stringify(traces.slice(0, 3)).slice(0, 12000));
        console.error("Browser page errors:", JSON.stringify(errors.slice(0, 3)));
        throw new Error("Hydration diagnosis: stop at first affected route");
      }
    }
  }
  if (errors.length) console.error("Browser error totals by route:", JSON.stringify(errors.reduce((a,e)=>{ a[e.route]=(a[e.route]||0)+1; return a; }, {})));
  assert.deepEqual(errors, [], "Unexpected browser runtime errors");
  console.log("Visual geometry checks passed:", results.length, "viewport/page combinations");
} finally {
  await writeFile(`${out}/geometry.json`, JSON.stringify(results, null, 2));
  await browser?.close();
  preview.kill("SIGTERM");
}
