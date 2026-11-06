/**
 * Probe actual Chromium, Firefox and WebKit launches before running apt.
 * The GitHub runner changes from job to job. A binary cache hit does not tell
 * us whether native libraries are missing, but a successful launch does.
 * 'detect' only decides whether repair is needed; 'verify' fails closed.
 */
import { appendFileSync, existsSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const mode = process.argv[2];
if (mode !== "detect" && mode !== "verify") {
  throw new Error("Usage: node scripts/ci-browser-runtime.mjs detect|verify");
}
const failed = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const binary = engine.executablePath();
  if (!existsSync(binary)) {
    failed.push(`${name}: missing binary ${binary}`);
    continue;
  }
  let browser;
  try {
    browser = await engine.launch({ headless: true, timeout: 15_000 });
    const page = await browser.newPage();
    await page.goto("data:text/html,<title>Waylan QA ready</title>");
    await page.close();
    console.log(`${name}: runtime ready`);
  } catch (error) {
    failed.push(`${name}: ${String(error?.message ?? error).slice(0, 1600)}`);
  } finally {
    await browser?.close();
  }
}
if (mode === "detect") {
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("Browser dependency probe requires GITHUB_OUTPUT");
  }
  appendFileSync(process.env.GITHUB_OUTPUT,
    `needs_linux_deps=${failed.length ? "true" : "false"}\n`);
  if (failed.length) console.warn("Missing browser runtime dependencies; attempting apt repair:\n" + failed.join("\n"));
  else console.log("All engines launch: skip apt dependencies");
} else if (failed.length) {
  throw new Error("Browser runtime verification failed after dependency repair:\n" + failed.join("\n"));
}
