import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { classify, needsFullVisual, coreMode, visualScope, responsiveImpact } from "./ci-plan.mjs";

test("docs-only changes keep a successful, low-cost status", () => {
  assert.deepEqual(classify(["README.md", "docs/ops/BRANCH_ARCHIVE.md"]),
    { code: false, browser: false, reader: false, feed: false, motion: false });
});
test("server-only PR keeps strict core tests without public-browser setup", () => {
  const p = classify(["worker/index.ts"]);
  assert.equal(p.code, true);
  assert.equal(p.browser, false);
  assert.equal(p.reader, false);
  assert.equal(p.motion, false);
  assert.equal(coreMode(["worker/index.ts"]), "full");
});
test("reader changes run targeted reader QA, without feed or motion duplication", () => {
  const p = classify(["src/components/Reader.tsx"]);
  assert.equal(p.reader, true);
  assert.equal(p.feed, false);
  assert.equal(p.motion, false);
});
test("global design changes use exhaustive visual review without unrelated functional suites", () => {
  const p = classify(["src/styles/site.css"]);
  assert.ok(p.code && p.browser);
  assert.equal(p.reader, false);
  assert.equal(p.feed, false);
  assert.equal(p.motion, false);
  assert.equal(needsFullVisual(["src/styles/site.css"]), true);
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

test("full visual matrix is reserved for cross-cutting changes and manual audits", () => {
  for (const file of ["src/styles.css", "src/styles/index.ts", "src/styles/skins.css",
    "src/styles/site.css", "src/App.tsx", "src/lib/router.tsx", "scripts/visual-smoke.mjs"]) {
    assert.equal(needsFullVisual([file]), true, file);
    assert.equal(needsFullVisual([file], "push"), false, file);
  }
  for (const file of ["src/styles/responsive.css", "src/styles/feed.css",
    "src/pages/About.tsx", "src/components/NotificationBell.tsx"]) {
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
  assert.ok(workflow.includes("WAYLAN_VISUAL_SCOPE: ${{ steps.plan.outputs.visual_scope }}"),
    "ordinary changes must pass their affected-page scope to the focused visual gate");
  assert.ok(workflow.includes("WAYLAN_VISUAL_MATRIX: full"),
    "explicit exhaustive reviews must keep all breakpoint boundaries");
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

test("local style edits build and check only their affected pages", () => {
  for (const [file, scope] of [
    ["src/styles/feed.css", "feed"],
    ["src/styles/projects.css", "projects"],
    ["src/styles/reader-progress.css", "reader"],
    ["src/styles/responsive.css", "all"],
  ]) {
    assert.equal(coreMode([file]), "build", file);
    assert.equal(visualScope([file]), scope, file);
    const plan = classify([file]);
    assert.equal(plan.browser, true, file);
    assert.equal(plan.reader, false, file);
    assert.equal(plan.feed, file === "src/styles/feed.css", file);
    assert.equal(plan.motion, false, file);
    assert.equal(needsFullVisual([file]), false, file);
  }
});
test("code, docs and policy changes preserve their appropriate core gates", () => {
  assert.equal(coreMode(["README.md"]), "none");
  assert.equal(coreMode([".github/workflows/verify.yml", "scripts/ci-plan.mjs"]), "policy");
  assert.equal(coreMode(["src/styles/feed.css", "src/components/Feed.tsx"]), "full");
  assert.equal(coreMode(["src/styles/index.ts"]), "full");
  assert.equal(coreMode(["worker/index.ts"]), "full");
  assert.equal(coreMode([], true), "full");
  assert.equal(visualScope(["src/admin/App.tsx"]), "none");
  assert.equal(visualScope(["src/components/Feed.tsx"]), "feed");
  assert.equal(visualScope(["src/styles/feed.css", "src/pages/Projects.tsx"]), "all");
});
test("a first browser failure stops later QA, but retains artifacts", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const conditions = workflow.split("\n").filter((line) => line.trim().startsWith("if:"));
  const unconditionalAfterFailure = conditions.filter((line) => line.includes("!cancelled()"));
  assert.equal(unconditionalAfterFailure.length, 1,
    "only the evidence-upload step may continue after a failure");
  assert.ok(unconditionalAfterFailure[0].includes("failure()"),
    "failure evidence must still be retained");
  assert.ok(workflow.includes("steps.plan.outputs.core_mode == 'build'"));
  assert.ok(workflow.includes("steps.plan.outputs.core_mode == 'full'"));
  assert.ok(workflow.includes("node scripts/ci-visual-focused.mjs"));
});

test("a two-property mobile feed CSS edit checks only the feed and its breakpoint", () => {
  const before = [
    "@media (max-width: 767px) {",
    "  .feed-controls .feed-result-line {",
    "    min-height: 48px;",
    "    border-top: 1px solid var(--line);",
    "  }",
    "  .feed-controls .view-toggle {",
    "    padding: 0;",
    "  }",
    "}",
  ].join("\n");
  const after = [
    "@media (max-width: 767px) {",
    "  .feed-controls .feed-result-line {",
    "    min-height: 48px;",
    "  }",
    "  .feed-controls .view-toggle {",
    "    padding: 0;",
    "    border: 0;",
    "  }",
    "}",
  ].join("\n");
  const diff = [
    "@@ -4 +3,0 @@",
    "-    border-top: 1px solid var(--line);",
    "@@ -7,0 +7 @@",
    "+    border: 0;",
  ].join("\n");
  const result = responsiveImpact(before, after, diff);
  assert.deepEqual(result, { scope: "feed-phone", phone: true });
  assert.equal(visualScope(["src/styles/responsive.css"], false, result.scope), "feed-phone");
  assert.equal(coreMode(["src/styles/responsive.css"]), "build");
  const focused = readFileSync("scripts/ci-visual-focused.mjs", "utf8");
  assert.match(focused, /"feed-phone": \["\/feed"\]/);
  assert.match(focused, /scope === "feed-phone"/);
  assert.match(focused, /\[768, 767, 390, 320\]/);
});
test("ambiguous responsive or shared selectors still retain all-page verification", () => {
  const before = "@media (max-width: 767px) {\n  .site-header {\n    height: 60px;\n  }\n}";
  const after = "@media (max-width: 767px) {\n  .site-header {\n    height: 64px;\n  }\n}";
  assert.equal(responsiveImpact(before, after,
    "@@ -3 +3 @@\n-    height: 60px;\n+    height: 64px;").scope, "all");
  assert.deepEqual(responsiveImpact("", "", ""), { scope: "all", phone: false });
  for (const [owner, expected] of [
    [".home-hero", "home"],
    [".archive-main", "archive"],
    [".about-layout", "about"],
    [".projects-layout", "projects"],
    [".reader-toc", "reader"],
  ]) {
    const before = owner + " {\n  padding: 8px;\n}";
    const after = owner + " {\n  padding: 12px;\n}";
    const change = "@@ -2 +2 @@\n-  padding: 8px;\n+  padding: 12px;";
    assert.equal(responsiveImpact(before, after, change).scope, expected, owner);
  }
  const wideBefore = ".feed-controls {\n  padding: 8px;\n}";
  const wideAfter = ".feed-controls {\n  padding: 12px;\n}";
  assert.deepEqual(responsiveImpact(wideBefore, wideAfter,
    "@@ -2 +2 @@\n-  padding: 8px;\n+  padding: 12px;"),
    { scope: "feed-only", phone: false });
});

test("real phone Home spacing edit stays on Home, including inline rules and changed comments", () => {
  // Regression for PR #204, which previously ran 96 all-site cases.
  const before = [
    "@media (max-width: 767px) {",
    "  .home-list .feed-excerpt { line-height: 1.7; }",
    "  .site-main:has(.home-page) { padding-bottom: var(--space-4); }",
    "  .home-topic-shortcuts { padding-bottom: var(--space-2); }",
    "}",
  ].join("\n");
  const after = [
    "@media (max-width: 767px) {",
    "  .home-list .feed-excerpt { line-height: 1.7; }",
    "  /* The 44px topic links already provide a full touch target; avoid",
    "     stacking shortcut padding with the page's closing gap above the footer. */",
    "  .site-main:has(.home-page) { padding-bottom: var(--space-2); }",
    "  .home-topic-shortcuts { padding-block: 0; }",
    "}",
  ].join("\n");
  const diff = [
    "@@ -3,2 +3,4 @@",
    "-  .site-main:has(.home-page) { padding-bottom: var(--space-4); }",
    "-  .home-topic-shortcuts { padding-bottom: var(--space-2); }",
    "+  /* The 44px topic links already provide a full touch target; avoid",
    "+     stacking shortcut padding with the page's closing gap above the footer. */",
    "+  .site-main:has(.home-page) { padding-bottom: var(--space-2); }",
    "+  .home-topic-shortcuts { padding-block: 0; }",
  ].join("\n");
  assert.deepEqual(responsiveImpact(before, after, diff),
    { scope: "home", phone: true });
  assert.equal(visualScope(["src/styles/responsive.css"], false,
    responsiveImpact(before, after, diff).scope), "home");
});

test("inline shared and mixed-page rules fall back to all pages", () => {
  for (const [before, after] of [
    [".site-header { height: 60px; }", ".site-header { height: 64px; }"],
    [".home-page, .feed-page { padding: 8px; }",
      ".home-page, .feed-page { padding: 12px; }"],
  ]) {
    assert.equal(responsiveImpact(before, after, "@@ -1 +1 @@").scope, "all");
  }
  const before = "@media (max-width: 767px) {\n  .feed-controls { padding: 8px; }\n}";
  const after = "@media (max-width: 767px) {\n  .feed-controls { padding: 12px; }\n}";
  assert.deepEqual(responsiveImpact(before, after,
    "@@ -2 +2 @@\n-  .feed-controls { padding: 8px; }\n+  .feed-controls { padding: 12px; }"),
    { scope: "feed-phone", phone: true });
});
