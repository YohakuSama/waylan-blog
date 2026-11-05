/**
 * Choose QA by changed surfaces, rather than starting six independent CI jobs.
 * Missing git history fails open to FULL QA (never silently skips checks).
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const docOnly = (p) =>
  p.startsWith("docs/") || p === "README.md" || p === "LICENSE" ||
  p.startsWith(".github/ISSUE_TEMPLATE/");

const sharedUI = (p) =>
  p === "src/App.tsx" || p === "src/client.tsx" || p === "src/offline.tsx" ||
  p === "src/styles.css" || p.startsWith("src/styles/") ||
  p === "src/lib/router.tsx" || p === "src/lib/motion.ts" ||
  p === "src/lib/data.ts" || p === "src/lib/appearance.ts" ||
  p === "src/lib/runtime.ts" || p === "src/lib/storage.ts" ||
  p === "src/lib/api.ts" || p.startsWith("content/") ||
  p.startsWith("shared/") || p.startsWith("public/") || p === "index.html";

const relevant = (paths, fn) => paths.some(fn);

export function classify(paths, event = "pull_request", forceFull = false) {
  if (forceFull) return { code: true, browser: true, reader: true, feed: true, motion: true };
  const code = relevant(paths, (p) => !docOnly(p));
  const ui = relevant(paths, (p) =>
    p.startsWith("src/") || p.startsWith("content/") ||
    p.startsWith("worker/") || p.startsWith("shared/") ||
    p.startsWith("scripts/") || p.startsWith("tests/") || p.startsWith("public/") ||
    p === "index.html" || p.startsWith(".github/workflows/") ||
    ["package.json", "package-lock.json", "vite.config.ts"].includes(p));
  // An accepted PR has run browser gates; do not repeat all browser installs
  // on the ensuing main push. Direct main pushes still run the core check.
  const browser = code && ui && event === "pull_request";
  const infrastructure = (p) => p.startsWith(".github/workflows/") ||
    p === "scripts/ci-plan.mjs" || p === "package.json" || p === "package-lock.json";
  const reader = browser && relevant(paths, (p) =>
    sharedUI(p) || infrastructure(p) || p.startsWith("src/components/Notification") ||
    p.startsWith("src/components/Shelf") ||
    /^(src\/components\/(Reader|UI|Settings|Feed|Network)|src\/lib\/(selection|reader|appearance|reveal)|scripts\/(reader|responsive-navigation|selection-composer|route-motion)|tests\/(selection|navigation|mobile-regressions))/i.test(p));
  const feed = browser && relevant(paths, (p) =>
    sharedUI(p) || infrastructure(p) ||
    /^(src\/pages\/(Feed|Home|Archive)|src\/components\/(Feed|Sidebar|UI)|src\/lib\/(api|views)|scripts\/(excerpt|interaction-state|visual)|tests\/(navigation|mobile-regressions|home-responsive))/i.test(p));
  const motion = browser && relevant(paths, (p) =>
    infrastructure(p) || p === "src/lib/motion.ts" ||
    p === "src/lib/router.tsx" || p === "src/App.tsx" ||
    p === "src/styles.css" || p.startsWith("src/styles/") ||
    /^(scripts\/(live-sort-motion|route-motion|quality)|tests\/motion)/.test(p));
  return { code, browser, reader, feed, motion };
}

function changedPaths() {
  const base = process.env.CI_BASE_SHA || "";
  const head = process.env.CI_HEAD_SHA || "";
  if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head) ||
      /^0{40}$/.test(base))
    return ["src/App.tsx", ".github/workflows/verify.yml"];
  try {
    return execFileSync("git", ["diff", "--no-renames", "--name-only", base, head], {
      encoding: "utf8", maxBuffer: 4_000_000,
    }).split("\n").map((x) => x.trim()).filter(Boolean);
  } catch (error) {
    console.error("Cannot identify changes; using full QA:", error.message);
    return ["src/App.tsx", ".github/workflows/verify.yml"];
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.GITHUB_EVENT_NAME || "pull_request";
  const full = process.env.CI_FORCE_FULL === "true";
  const paths = full ? [] : changedPaths();
  const plan = classify(paths, event, full);
  const result = Object.entries(plan).map(([key, value]) => key + "=" + value).join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, result);
  console.log(JSON.stringify({ event, full, paths, plan }, null, 2));
}
