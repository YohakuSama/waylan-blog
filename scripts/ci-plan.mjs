/**
 * Select verification from changed surfaces. Unknown diff history uses full QA.
 * The full browser matrix remains available through workflow_dispatch.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const docOnly = (p) =>
  p.startsWith("docs/") || p === "README.md" || p === "LICENSE" ||
  p === "public/images/README.txt" ||
  p.startsWith(".github/ISSUE_TEMPLATE/");
const relevant = (paths, fn) => paths.some(fn);
const style = (p) => p === "src/styles.css" ||
  (p.startsWith("src/styles/") && p.endsWith(".css"));
const policyOnly = (p) =>
  p.startsWith(".github/workflows/") ||
  ["scripts/ci-plan.mjs", "scripts/maintenance.test.mjs",
    "scripts/branch-maintenance.mjs", "scripts/mobile-layout-audit.mjs"].includes(p);

// Shared application logic can affect multiple features; shared styling does
// not imply that every interactive regression suite must run.
const sharedLogic = (p) =>
  ["src/App.tsx", "src/client.tsx", "src/offline.tsx",
    "src/lib/router.tsx", "src/lib/motion.ts", "src/lib/data.ts",
    "src/lib/appearance.ts", "src/lib/runtime.ts", "src/lib/storage.ts",
    "src/lib/api.ts"].includes(p) ||
  p.startsWith("content/") || p.startsWith("shared/");

// Only cross-cutting design/system changes require exhaustive visual review.
// A change to responsive.css gets a representative all-page layout pass instead.
const fullVisualOwners = new Set([
  "src/styles.css", "src/styles/index.ts", "src/styles/skins.css",
  "src/styles/site.css", "src/App.tsx", "src/lib/router.tsx",
  "scripts/visual-smoke.mjs",
]);
export function needsFullVisual(paths, event = "pull_request", forceFull = false) {
  return forceFull || (event === "pull_request" &&
    relevant(paths, (p) => fullVisualOwners.has(p)));
}

export function classify(paths, event = "pull_request", forceFull = false) {
  if (forceFull) return { code: true, browser: true, reader: true, feed: true, motion: true };
  const code = relevant(paths, (p) => !docOnly(p));
  const ui = relevant(paths, (p) =>
    p.startsWith("src/") || p.startsWith("content/") ||
    p.startsWith("shared/") || p.startsWith("public/") ||
    (p.startsWith("scripts/") && !policyOnly(p)) ||
    p === "index.html" ||
    ["package.json", "package-lock.json", "vite.config.ts"].includes(p));
  // Server-only and policy-only edits have no public-browser surface.
  const browser = code && ui && event === "pull_request";
  const reader = browser && relevant(paths, (p) =>
    sharedLogic(p) ||
    p.startsWith("src/features/reader/") ||
    p.startsWith("src/features/discussions/") ||
    p.startsWith("src/features/annotations/") ||
    p.startsWith("src/components/Notification") ||
    p.startsWith("src/components/Shelf") ||
    /^(src\/components\/(Reader|UI|Settings|Network)|src\/lib\/(selection|reader|reveal)|scripts\/(reader|responsive-navigation|selection-composer|route-motion))/i.test(p));
  const feed = browser && relevant(paths, (p) =>
    sharedLogic(p) || p === "src/styles/feed.css" ||
    /^(src\/pages\/(Feed|Home|Archive)|src\/components\/(Feed|Sidebar|UI)|src\/lib\/views|scripts\/(excerpt|interaction-state))/i.test(p));
  const motion = browser && relevant(paths, (p) =>
    ["src/lib/motion.ts", "src/lib/router.tsx", "src/App.tsx",
      "src/styles/motion.css"].includes(p) ||
    /^(scripts\/(live-sort-motion|route-motion)|tests\/motion)/.test(p));
  return { code, browser, reader, feed, motion };
}

// CSS-only changes still build/prerender and pass static integrity checks,
// but cannot invalidate unrelated application unit-test logic.
export function coreMode(paths, forceFull = false) {
  if (forceFull) return "full";
  if (!relevant(paths, (p) => !docOnly(p))) return "none";
  const changed = paths.filter((p) => !docOnly(p));
  if (changed.every(policyOnly)) return "policy";
  if (changed.every(style)) return "build";
  return "full";
}

// A focused browser pass follows the owning page(s), not the entire site.
// "all" still checks representative widths for genuinely shared surfaces.
export function visualScope(paths, forceFull = false, responsiveScope = "all") {
  if (forceFull) return "all";
  const scopes = new Set();
  for (const p of paths) {
    if (docOnly(p) || policyOnly(p) ||
        p.startsWith("worker/") || p.startsWith("tests/") ||
        p.startsWith("src/admin/")) continue;
    if (p === "src/styles/responsive.css") scopes.add(responsiveScope);
    else if (p === "src/styles/feed.css" || p.startsWith("src/components/Feed") ||
        p.startsWith("src/pages/Feed")) scopes.add("feed");
    else if (p === "src/styles/projects.css" || p.startsWith("src/pages/Projects")) scopes.add("projects");
    else if (p === "src/styles/image-viewer.css" ||
        p === "src/styles/reader-progress.css" ||
        p.startsWith("src/features/reader/") || p.startsWith("src/pages/Article") ||
        p.startsWith("src/components/Reader")) scopes.add("reader");
    else if (p.startsWith("src/pages/Home")) scopes.add("home");
    else if (p.startsWith("src/pages/Archive")) scopes.add("archive");
    else if (p.startsWith("src/pages/About")) scopes.add("about");
    else scopes.add("all");
  }
  if (scopes.size === 0) return "none";
  return scopes.size === 1 ? [...scopes][0] : "all";
}

// Determine which page a responsive CSS hunk actually changes. Only an
// unambiguous, feed-scoped selector can narrow the checks; everything else
// conservatively keeps the current cross-page visual coverage.
function cssRuleAt(source, targetLine) {
  const stack = [], openedSelectors = [];
  let token = "", comment = false, quote = "", line = 1, hasCode = false;
  for (let i = 0; i < source.length && line <= targetLine; i++) {
    const c = source[i], next = source[i + 1];
    if (c === "\n") { line++; continue; }
    if (comment) {
      if (c === "*" && next === "/") { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && next === "*") { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; }
    if (line === targetLine && !/\s/.test(c)) hasCode = true;
    if (c === "{") {
      const rule = token.trim();
      stack.push(rule);
      // Single-line rules close their block before the end of the line.
      // Preserve the selector seen on this line rather than losing its owner.
      if (line === targetLine && rule && !rule.startsWith("@"))
        openedSelectors.push(rule);
      token = "";
    } else if (c === "}") { stack.pop(); token = ""; }
    else if (c === ";") token = "";
    else token += c;
  }
  return {
    selector: openedSelectors.join(", ") ||
      [...stack].reverse().find((rule) => rule && !rule.startsWith("@")) || "",
    phone: stack.some((rule) => /^@media\b/i.test(rule) &&
      /\bmax-width\s*:\s*767px\b/i.test(rule)),
    commentOnly: !hasCode,
  };
}

// Page-level CSS ownership, not a rule for every individual component.
// Only selectors clearly nested under one page-specific namespace are narrowed.
function cssSelectorScope(selector) {
  const owners = [
    ["feed-only", /\.(?:feed-controls|feed-page|feed-layout|feed-toolbar)(?![\w-])/],
    ["home", /\.(?:home-page|home-hero|home-sidebar|home-side-topics|home-list|home-links|home-resume|home-topic-shortcuts)(?![\w-])/],
    ["archive", /\.archive-(?:main|activity|row|month)(?![\w-])/],
    ["projects", /\.projects-layout(?![\w-])/],
    ["about", /\.about-(?:layout|details)(?![\w-])/],
    ["reader", /\.(?:reader-layout|reader-toc)(?![\w-])/],
  ];
  const scopes = new Set();
  for (const part of selector.split(",")) {
    const matched = owners.filter(([, pattern]) => pattern.test(part));
    if (matched.length !== 1) return "all";
    scopes.add(matched[0][0]);
  }
  return scopes.size === 1 ? [...scopes][0] : "all";
}

export function responsiveImpact(before, after, patch) {
  const fallback = { scope: "all", phone: false };
  if (!before || !after || !patch) return fallback;
  const hunks = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)];
  if (!hunks.length) return fallback;
  let phone = true;
  let scope = null;
  let inspected = 0;
  for (const hunk of hunks) {
    const [, oldStart, oldCount = "1", newStart, newCount = "1"] = hunk;
    for (const [source, start, count] of [
      [before, Number(oldStart), Number(oldCount)],
      [after, Number(newStart), Number(newCount)],
    ]) {
      for (let n = 0; n < count; n++) {
        const context = cssRuleAt(source, start + n);
        // Comments do not affect layout ownership; ignore them rather
        // than expanding a small CSS edit into an all-site visual audit.
        if (context.commentOnly) continue;
        // Shared card selectors, mixed page ownership and ambiguous changes
        // must not silently skip affected pages.
        const owner = cssSelectorScope(context.selector);
        if (owner === "all" || (scope && scope !== owner)) return fallback;
        scope = owner;
        phone &&= context.phone;
        inspected++;
      }
    }
  }
  return inspected && scope
    ? { scope: scope === "feed-only" && phone ? "feed-phone" : scope, phone }
    : fallback;
}

function changedResponsiveImpact() {
  const base = process.env.CI_BASE_SHA || "";
  const head = process.env.CI_HEAD_SHA || "";
  if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head))
    return { scope: "all", phone: false };
  try {
    const path = "src/styles/responsive.css";
    const before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    const after = readFileSync(path, "utf8");
    const patch = execFileSync("git",
      ["diff", "--no-ext-diff", "--unified=0", base, head, "--", path],
      { encoding: "utf8", maxBuffer: 4_000_000 });
    return responsiveImpact(before, after, patch);
  } catch (error) {
    console.error("Cannot resolve responsive CSS ownership; use broad visual QA:", error.message);
    return { scope: "all", phone: false };
  }
}

const interactiveUI = (p) =>
  p === "src/App.tsx" || p === "src/lib/router.tsx" ||
  p.startsWith("src/components/") || p.startsWith("src/features/") ||
  p === "scripts/functional-ui-smoke.mjs";
const qualityUI = (p) =>
  p === "src/App.tsx" || p.startsWith("src/admin/") ||
  ["src/styles/skins.css", "src/styles/site.css", "src/styles.css",
    "scripts/quality-smoke.mjs"].includes(p);
const accessibleUI = (p) =>
  p === "src/App.tsx" || p.startsWith("src/components/") ||
  p.startsWith("src/pages/") || p.startsWith("src/admin/") ||
  ["src/styles/skins.css", "src/styles/site.css",
    "scripts/a11y-smoke.mjs"].includes(p);

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
  const visualFull = needsFullVisual(paths, event, full);
  const responsive = !full && paths.includes("src/styles/responsive.css")
    ? changedResponsiveImpact() : { scope: "all", phone: false };
  const scope = visualScope(paths, full, responsive.scope);
  const mode = coreMode(paths, full);
  const functional = full || (plan.browser && relevant(paths, interactiveUI));
  const quality = full || (plan.browser && relevant(paths, qualityUI));
  const a11y = full || (plan.browser && relevant(paths, accessibleUI));
  const adminEvidence = paths.some((p) => p.startsWith("src/admin/") ||
    p === "scripts/quality-smoke.mjs" || p === "scripts/a11y-smoke.mjs");
  const result = Object.entries(plan).map(([key, value]) => key + "=" + value).join("\n") +
    "\ncore_mode=" + mode + "\nvisual_full=" + visualFull +
    "\nvisual_scope=" + scope + "\nfunctional=" + functional +
    "\nquality=" + quality + "\na11y=" + a11y +
    "\nadmin_evidence=" + adminEvidence + "\n";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, result);
  console.log(JSON.stringify({ event, full, paths, plan, mode, scope, visualFull }, null, 2));
}
