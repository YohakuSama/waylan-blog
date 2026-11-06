import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { classify, needsFullVisual } from "./ci-plan.mjs";

test("docs-only changes keep a successful, low-cost status", () => {
  assert.deepEqual(classify(["README.md", "docs/ops/BRANCH_ARCHIVE.md"]),
    { code: false, browser: false, reader: false, feed: false, motion: false });
});
test("server-only PR runs core plus relevant browser QA, not reader or motion", () => {
  const p = classify(["worker/index.ts"]);
  assert.equal(p.code, true);
  assert.equal(p.browser, true);
  assert.equal(p.reader, false);
  assert.equal(p.motion, false);
});
test("reader changes run targeted reader QA, without feed or motion duplication", () => {
  const p = classify(["src/components/Reader.tsx"]);
  assert.equal(p.reader, true);
  assert.equal(p.feed, false);
  assert.equal(p.motion, false);
});
test("shared design changes run all affected groups", () => {
  const p = classify(["src/styles/site.css"]);
  assert.ok(p.code && p.browser && p.reader && p.feed && p.motion);
});
test("CI-only maintenance changes keep core verification without browser installation", () => {
  const expected = { code: true, browser: false, reader: false, feed: false, motion: false };
  for (const path of [
    ".github/workflows/verify.yml", "scripts/ci-plan.mjs",
    "scripts/maintenance.test.mjs", "scripts/branch-maintenance.mjs",
    "scripts/mobile-layout-audit.mjs",
  ]) assert.deepEqual(classify([path]), expected, path);
});
test("removed images placeholder does not invoke build or browser QA", () => {
  assert.equal(classify(["public/images/README.txt"]).code, false);
});
test("main pushes retain the core gate without duplicate browser installation", () => {
  const p = classify(["src/App.tsx"], "push");
  assert.equal(p.code, true);
  assert.equal(p.browser, false);
});
test("owner-requested full suite bypasses file filtering", () => {
  const p = classify([], "workflow_dispatch", true);
  assert.ok(Object.values(p).every(Boolean));
});

test("published Markdown never counts as documentation-only", () => {
  assert.deepEqual(classify(["content/notes/example.md"]), {
    code: true, browser: true, reader: true, feed: true, motion: false,
  });
});
test("public assets and routes still trigger visual QA", () => {
  for (const path of ["public/logo.svg", "index.html"]) {
    const p = classify([path]);
    assert.equal(p.code, true);
    assert.equal(p.browser, true);
  }
});

test("reader feature submodules select reader QA without unrelated feed/motion groups", () => {
  for (const path of [
    "src/features/reader/ReaderToc.tsx",
    "src/features/reader/ArticleHeader.tsx",
    "src/features/discussions/CommentItem.tsx",
    "src/features/discussions/model.ts",
    "src/features/annotations/FutureFeature.tsx",
  ]) {
    const p = classify([path]);
    assert.equal(p.code, true, path);
    assert.equal(p.browser, true, path);
    assert.equal(p.reader, true, path);
    assert.equal(p.feed, false, path);
    assert.equal(p.motion, false, path);
  }
});

test("browser QA uses the pinned image and always launches three engines before testing", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /container:\s*\n\s*image: mcr\.microsoft\.com\/playwright:v1\.56\.1-noble/);
  assert.match(workflow, /id: browsers\s+if:[^\n]+\n\s+timeout-minutes: 3/);
  assert.ok(workflow.includes("npm install --no-save --no-package-lock playwright@1.56.1"),
    "the image and test package must pin the same Playwright version");
  assert.ok(workflow.includes("node scripts/ci-browser-runtime.mjs verify"),
    "all three engines must launch successfully before browser test gates can pass");
  assert.doesNotMatch(workflow, /npx playwright install-deps|actions\/cache\/restore@v4|actions\/cache\/save@v4/,
    "the pinned image must not repeat slow apt downloads or redundant browser caches");
  const probe = readFileSync("scripts/ci-browser-runtime.mjs", "utf8");
  for (const name of ["chromium", "firefox", "webkit"]) assert.ok(probe.includes(name));
  assert.ok(probe.includes("engine.launch") && probe.includes("browser.newPage") &&
    probe.includes("Browser runtime verification failed"),
    "probe must actively launch every browser and fail closed");
  assert.ok(workflow.indexOf("Verify pinned Chromium, Firefox and WebKit runtimes") <
    workflow.indexOf("Phone, tablet and desktop layout"),
    "the browser launch check precedes visual audits");
  assert.ok(workflow.includes("steps.browsers.outcome == 'success'"),
    "a missing browser binary must never silently skip QA");
});

test("shared visual owners request exhaustive boundaries only on review PRs", () => {
  for (const file of ["src/styles.css", "src/styles/index.ts", "src/styles/responsive.css", "src/styles/skins.css"]) {
    assert.equal(needsFullVisual([file]), true, file);
    assert.equal(needsFullVisual([file], "push"), false, "main pushes do not rerun browser QA");
  }
  for (const file of ["src/pages/About.tsx", "src/components/NotificationBell.tsx", "src/styles/feed.css"]) {
    assert.equal(needsFullVisual([file]), false, file);
  }
  assert.equal(needsFullVisual([], "workflow_dispatch", true), true);
  assert.equal(needsFullVisual(["src/styles/responsive.css", "src/App.tsx"]), true);
});
test("PR visual smoke checks all skins and representative device widths, full keeps breakpoint boundaries", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const visual = readFileSync("scripts/visual-smoke.mjs", "utf8");
  const parse = (name) => {
    const match = visual.match(new RegExp(`const ${name} = \\[([^\\]]+)\\];`));
    assert.ok(match, `missing ${name}`);
    return match[1].split(",").map(x => Number(x.trim()));
  };
  const focused = parse("smokeWidths");
  const full = parse("fullWidths");
  assert.deepEqual(focused, [1440, 1025, 1024, 860, 768, 767, 601, 390, 320]);
  assert.equal(full.length, 18);
  assert.ok(full.includes(600) && full.includes(601), "retain both sides of the former phone-cover boundary");
  assert.ok(full.includes(1024) && full.includes(1025), "retain both sides of the tablet filter boundary");
  for (const width of focused) assert.ok(full.includes(width));
  assert.match(workflow, /WAYLAN_VISUAL_MATRIX:/);
  assert.ok(workflow.includes("steps.plan.outputs.visual_full == 'true' && 'full' || 'smoke'"),
    "shared global CSS PRs and manually requested checks must use all 18 widths");
  assert.ok(workflow.includes("failure() || steps.plan.outputs.visual_full == 'true'"),
    "full breakpoint reviews must retain screenshot evidence");
  assert.match(visual, /matrix === "smoke" \? smokeWidths : fullWidths/);
});

test("draft PRs avoid runner compute, but ready-for-review and subsequent changes are gated", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]/);
  assert.ok(workflow.includes("if: ${{ github.event_name != 'pull_request' || !github.event.pull_request.draft }}"));
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"),
    "new ready-PR revisions must supersede stale checks");
  assert.ok(workflow.includes("steps.plan.outputs.browser == 'true'"),
    "ready PRs must retain impacted browser checks");
  assert.ok(workflow.includes("timeout-minutes: 30"), "keep bounded runners");
  assert.doesNotMatch(workflow, /runs-on:.*self-hosted/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
});

test("clean installs and isolated browser states are not replaced by persisted site data", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const visual = readFileSync("scripts/visual-smoke.mjs", "utf8");
  assert.match(workflow, /run: npm ci/);
  assert.match(visual, /browser\.newContext\(\{/);
  assert.doesNotMatch(workflow, /node_modules\/|\.localStorage|cache:.*localStorage|\.cache\/vite/);
});
